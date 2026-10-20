// Todo lo que depende del DOM de Proton vive aquí. Si Proton cambia su UI,
// este es el único archivo que debería hacer falta ajustar.
// Confirmados en vivo: login (#username, #password, #staySignedIn, submit).
// El resto son mejores esfuerzos basados en los data-testid de Proton Mail.

export const URLS = {
  login: 'https://account.proton.me/login',
  mail: 'https://mail.proton.me/u/0',
};

export const FOLDERS = {
  inbox: 'inbox',
  sent: 'sent',
  drafts: 'drafts',
  archive: 'archive',
  spam: 'spam',
  trash: 'trash',
  starred: 'starred',
  all: 'all-mail',
};

export const SEL = {
  // login (confirmado)
  loginUser: '#username',
  loginPass: '#password',
  loginSubmit: 'button[type="submit"]',
  keepSignedIn: '#staySignedIn',
  // 2FA / verificaciones
  totp: '#totp, input[autocomplete="one-time-code"], input[id*="totp" i]',
  captcha: 'iframe[src*="captcha" i], iframe[title*="captcha" i], iframe[src*="hcaptcha" i]',
  // el banner informativo "We're changing the Proton sign-in page" también es role=alert: se excluye
  loginError:
    '[role="alert"]:not(:has-text("Close this banner")):not(:has-text("sign-in page")), .notification--error, [data-testid="notification:error"], .input-element-error, [class*="error-message" i]',
  // app de correo
  mailReady:
    '[data-testid="sidebar:compose"], [data-testid="navigation-link:inbox"], [data-shortcut-target="item-container"]',
  compose: '[data-testid="sidebar:compose"]',
  listItem: '[data-shortcut-target="item-container"][data-element-id]',
  itemSender: '[data-testid="message-column:sender-address"], [data-testid="message-column:sender"]',
  itemSubject: '[data-testid="message-column:subject"], [data-testid="message-row:subject"]',
  itemTime: '[data-testid="item-date-simple"], [data-testid="item-time-simple"], [data-testid="message-item:time"], time',
  contentIframe: 'iframe[data-testid="content-iframe"]',
  // banners "Cargar contenido remoto/incrustado" y adjuntos (mejor esfuerzo: ajustar aquí si Proton cambia su UI)
  loadContent: '[data-testid="remote-content:load"], [data-testid="embedded-content:load"], [data-testid^="message-view:load"]',
  loadContentText: /^(load (remote |embedded )?(content|images)|cargar (el )?(contenido|im[aá]genes)( remoto| incrustado)?)$/i,
  attachmentItem: '[data-testid="attachment-item"]',
  attachmentDownload: '[data-testid="attachment-item:download"], [data-testid*="download" i], button[title*="download" i], button[title*="descargar" i]',
  messageHeader: '[data-testid^="message-header"], [data-testid^="message-view"] header',
  // composer
  toolbarNext: '[data-testid="toolbar:next-element"]',
  composerTo: '[data-testid="composer:to"] input, input[data-testid="composer:to"]',
  composerSubject: '[data-testid="composer:subject"]',
  composerBodyIframe: 'iframe[data-testid="rooster-iframe"]',
  composerBody: '#rooster-editor',
  messageRow: '[data-testid^="message-view-"]',
  draftBadge: /^(borrador|draft)$/i, // etiqueta exacta
  draftWord: /\b(borrador|draft)\b/i, // dentro del texto de la fila
  composerClose: '[data-testid="composer:close-button"]',
  composerSend: '[data-testid="composer:send-button"]',
  composerCc: '[data-testid="composer:cc-button"]',
  composerBcc: '[data-testid="composer:bcc-button"]',
};
