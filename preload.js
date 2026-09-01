const { contextBridge, ipcRenderer } = require('electron');

// Pont étanche entre l'interface (renderer) et le main process.
// L'interface n'a JAMAIS accès direct à child_process / au système.
contextBridge.exposeInMainWorld('api', {
  // Envoie une description au CLI Claude Code, reçoit { html } ou { error }
  generateComponent: (prompt) => ipcRenderer.invoke('generate-component', prompt),
  // Conversation continue avec Claude (garde le contexte via session_id)
  sendChat: (payload) => ipcRenderer.invoke('send-chat', payload),
  // Deltas de streaming du chat (texte au fil de l'eau). Retourne un désabonnement.
  onChatDelta: (cb) => { const h = (e, t) => cb(t); ipcRenderer.on('chat-delta', h); return () => ipcRenderer.removeListener('chat-delta', h); },
  // Vérifie que le CLI claude est trouvable sur la machine
  checkClaude: () => ipcRenderer.invoke('check-claude'),
  // Bibliothèque de composants (persistée sur disque)
  libraryList: () => ipcRenderer.invoke('library-list'),
  librarySave: (item) => ipcRenderer.invoke('library-save', item),
  libraryDelete: (id) => ipcRenderer.invoke('library-delete', id),
  // Réglages persistés (userData/settings.json) — nom d'auteur, etc.
  settingsGet: () => ipcRenderer.invoke('settings-get'),
  settingsSet: (patch) => ipcRenderer.invoke('settings-set', patch),
  // Bibliothèque partagée en ligne (Supabase)
  sharedList: () => ipcRenderer.invoke('shared-list'),
  sharedPublish: (item) => ipcRenderer.invoke('shared-publish', item),
  sharedDelete: (payload) => ipcRenderer.invoke('shared-delete', payload),
  sharedUpdate: (payload) => ipcRenderer.invoke('shared-update', payload),
  sharedRenameAuthor: (payload) => ipcRenderer.invoke('shared-rename-author', payload),
  // Push direct d'une slice vers Prismic (custom_slice)
  pushPrismic: (payload) => ipcRenderer.invoke('push-prismic', payload),
  // Proxy prix API-SO (Referer forcé) pour que l'aperçu affiche les vrais prix
  getQuotation: (body) => ipcRenderer.invoke('get-quotation', body),
  // Mise à jour
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});
