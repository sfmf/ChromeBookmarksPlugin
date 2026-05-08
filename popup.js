document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('bookmarks');
  const searchInput = document.getElementById('search');

  let openFolders = [];
  let savedScrollTop = 0;
  let faviconCache = {};

  chrome.storage.local.get(['popupWidth', 'popupHeight', 'searchText', 'openFolders', 'scrollTop', 'faviconCache'], (data) => {
    document.documentElement.style.width = (data.popupWidth || 360) + 'px';
    document.documentElement.style.height = (data.popupHeight || 500) + 'px';
    document.body.style.width = (data.popupWidth || 360) + 'px';
    document.body.style.height = (data.popupHeight || 500) + 'px';
    if (data.searchText) {
      searchInput.value = data.searchText;
    }
    openFolders = data.openFolders || [];
    savedScrollTop = data.scrollTop || 0;
    faviconCache = data.faviconCache || {};
    loadBookmarks(data.searchText || '');
  });

  const resizer = document.createElement('div');
  resizer.className = 'resizer';
  document.body.appendChild(resizer);

  let isResizing = false;
  let startX, startY, startW, startH;

  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startY = e.clientY;
    startW = document.documentElement.offsetWidth;
    startH = document.documentElement.offsetHeight;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const newW = Math.max(300, startW + (e.clientX - startX));
    const newH = Math.max(400, startH + (e.clientY - startY));
    document.documentElement.style.width = newW + 'px';
    document.documentElement.style.height = newH + 'px';
    document.body.style.width = newW + 'px';
    document.body.style.height = newH + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    const w = document.documentElement.offsetWidth;
    const h = document.documentElement.offsetHeight;
    chrome.storage.local.set({ popupWidth: w, popupHeight: h });
  });

  function saveState() {
    const openIds = [];
    container.querySelectorAll('.folder-content.open').forEach((el) => {
      const folder = el.parentElement;
      const id = folder.dataset.folderId;
      if (id) {
        openIds.push(id);
      }
    });
    openFolders = openIds;
    chrome.storage.local.set({
      openFolders: openIds,
      scrollTop: container.scrollTop,
    });
  }

  function getFaviconKey(url) {
    try {
      const u = new URL(url);
      return u.hostname;
    } catch {
      return '';
    }
  }

  function renderTree(nodes, parentEl, depth = 0, autoOpen = false) {
    for (const node of nodes) {
      if (node.url) {
        const item = document.createElement('a');
        item.className = 'bookmark-item';
        item.href = node.url;
        item.target = '_blank';
        item.style.paddingLeft = `${12 + depth * 16}px`;

        const key = getFaviconKey(node.url);
        const cached = key ? faviconCache[key] : null;

        const img = document.createElement('img');
        img.className = 'favicon';
        img.alt = '';

        if (cached) {
          img.src = cached;
        } else {
          let faviconSrc = '';
          try {
            const u = new URL(node.url);
            if (u.origin) {
              faviconSrc = `${u.origin}/favicon.ico`;
            }
          } catch {}

          if (faviconSrc) {
            img.src = faviconSrc;
            img.onload = () => {
              try {
                const canvas = document.createElement('canvas');
                canvas.width = 16;
                canvas.height = 16;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, 16, 16);
                faviconCache[key] = canvas.toDataURL();
                chrome.storage.local.set({ faviconCache });
              } catch {}
            };
            img.onerror = () => {
              img.src = 'icons/default.png';
              faviconCache[key] = 'icons/default.png';
              chrome.storage.local.set({ faviconCache });
            };
          } else {
            img.src = 'icons/default.png';
          }
        }

        const title = document.createElement('span');
        title.className = 'title';
        title.textContent = node.title || node.url;

        item.appendChild(img);
        item.appendChild(title);

        item.addEventListener('click', (e) => {
          e.preventDefault();
          chrome.tabs.create({ url: node.url });
        });
        parentEl.appendChild(item);
      }

      if (node.children && node.children.length > 0) {
        if (!node.url) {
          const folderId = node.id || ('__synthetic__' + node.title);
          const isOpen = autoOpen || openFolders.includes(folderId);
          const folder = document.createElement('div');
          folder.className = 'folder';
          folder.dataset.folderId = folderId;
          const folderHeader = document.createElement('div');
          folderHeader.className = 'folder-header';
          folderHeader.style.paddingLeft = `${12 + depth * 16}px`;
          folderHeader.innerHTML = `
            <span class="folder-icon">📁</span>
            <span class="folder-name">${escapeHtml(node.title || '未命名文件夹')}</span>
            <span class="arrow">${isOpen ? '▼' : '▶'}</span>
          `;

          const folderContent = document.createElement('div');
          folderContent.className = isOpen ? 'folder-content open' : 'folder-content';

          folderHeader.addEventListener('click', () => {
            const nowOpen = folderContent.classList.toggle('open');
            folderHeader.querySelector('.arrow').textContent = nowOpen ? '▼' : '▶';
            saveState();
          });

          folder.appendChild(folderHeader);
          folder.appendChild(folderContent);
          parentEl.appendChild(folder);

          renderTree(node.children, folderContent, depth + 1, autoOpen);
        } else {
          renderTree(node.children, parentEl, depth, autoOpen);
        }
      }
    }
  }

  function loadBookmarks(filter = '') {
    chrome.bookmarks.getTree((tree) => {
      const rootNode = tree[0];
      if (!rootNode.children) return;

      const folders = [];
      const unclassified = [];

      for (const child of rootNode.children) {
        if (child.children) {
          for (const item of child.children) {
            if (item.url) {
              unclassified.push(item);
            } else if (item.children) {
              folders.push(item);
            }
          }
        }
      }

      const allNodes = [];
      if (unclassified.length > 0) {
        allNodes.push({
          id: '__unclassified__',
          title: '未分类',
          children: unclassified,
        });
      }
      allNodes.push(...folders);

      container.innerHTML = '';

      if (filter) {
        const filtered = filterTree(allNodes, filter.toLowerCase());
        renderTree(filtered, container, 0, true);
      } else {
        renderTree(allNodes, container, 0);
        setTimeout(() => {
          container.scrollTop = savedScrollTop;
        }, 50);
      }
    });
  }

  let scrollTimer = null;
  container.addEventListener('scroll', () => {
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      chrome.storage.local.set({ scrollTop: container.scrollTop });
    }, 100);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      saveState();
    }
  });

  window.addEventListener('beforeunload', () => {
    saveState();
  });

  function filterTree(nodes, keyword) {
    const result = [];
    for (const node of nodes) {
      if (node.url) {
        const title = (node.title || '').toLowerCase();
        const url = (node.url || '').toLowerCase();
        if (title.includes(keyword) || url.includes(keyword)) {
          result.push(node);
        }
      }
      if (node.children) {
        const filteredChildren = filterTree(node.children, keyword);
        if (filteredChildren.length > 0) {
          result.push({ ...node, children: filteredChildren });
        }
      }
    }
    return result;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  searchInput.addEventListener('input', (e) => {
    const text = e.target.value;
    chrome.storage.local.set({ searchText: text });
    loadBookmarks(text);
  });
});
