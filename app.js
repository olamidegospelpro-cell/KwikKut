import { removeBackground } from '@imgly/background-removal';

const input = document.querySelector('#file-input');
const dropZone = document.querySelector('#drop-zone');
const editor = document.querySelector('#editor');
const originalImage = document.querySelector('#original-image');
const originalName = document.querySelector('#original-name');
const fileDetails = document.querySelector('#file-details');
const resultImage = document.querySelector('#result-image');
const emptyResult = document.querySelector('#empty-result');
const overlay = document.querySelector('#processing-overlay');
const progressTitle = document.querySelector('#progress-title');
const progressDetail = document.querySelector('#progress-detail');
const progressBar = document.querySelector('#progress-bar');
const resultTag = document.querySelector('#result-tag');
const errorMessage = document.querySelector('#error-message');
const removeButton = document.querySelector('#remove-button');
const downloadButton = document.querySelector('#download-button');
const installButton = document.querySelector('#install-button');
const chooseAnotherButton = document.querySelector('#choose-another');
const clearButton = document.querySelector('#clear-button');
const unsavedDialog = document.querySelector('#unsaved-dialog');
const feedbackDialog = document.querySelector('#feedback-dialog');

const userAgent = navigator.userAgent;
const isIOS = /iPad|iPhone|iPod/.test(userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isSafari = /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Chromium|Android/.test(userAgent);
const useLightweightProcessing = isIOS || isSafari;

let sourceFile;
let sourceUrl;
let resultUrl;
let cutoutBlob;
let isSaved = true;
let unloadWarningAttached = false;
let installPrompt;
let jobNumber = 0;
let pendingAction;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function beforeUnload(event) {
  event.preventDefault();
  event.returnValue = '';
}

function updateUnloadWarning() {
  const shouldWarn = Boolean(cutoutBlob && !isSaved);
  if (shouldWarn && !unloadWarningAttached) {
    window.addEventListener('beforeunload', beforeUnload);
    unloadWarningAttached = true;
  } else if (!shouldWarn && unloadWarningAttached) {
    window.removeEventListener('beforeunload', beforeUnload);
    unloadWarningAttached = false;
  }
}

function clearResult() {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = undefined;
  cutoutBlob = undefined;
  isSaved = true;
  updateUnloadWarning();
  resultImage.removeAttribute('src');
  resultImage.hidden = true;
  emptyResult.hidden = false;
  downloadButton.hidden = true;
  resultTag.textContent = 'READY';
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function askBeforeDiscard(action) {
  if (cutoutBlob && !isSaved) {
    pendingAction = action;
    unsavedDialog.showModal();
    return;
  }
  action();
}

function loadFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showError('Please choose an image file (PNG, JPG, or WEBP).');
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    showError('This image is over 25 MB. Choose a smaller file to continue.');
    return;
  }
  askBeforeDiscard(() => loadFileNow(file));
}

function loadFileNow(file) {
  jobNumber++;
  sourceFile = file;
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceUrl = URL.createObjectURL(file);
  originalImage.src = sourceUrl;
  originalName.textContent = file.name;
  fileDetails.textContent = `${file.name} · ${formatBytes(file.size)}${isIOS ? ' · optimized for iPhone/iPad' : ''}`;
  editor.hidden = false;
  dropZone.hidden = true;
  overlay.hidden = true;
  removeButton.disabled = false;
  removeButton.hidden = false;
  removeButton.innerHTML = '<span aria-hidden="true">✳</span> Remove background';
  errorMessage.hidden = true;
  clearResult();
  removeButton.focus();
}

async function makeIOSFriendlyImage(file) {
  let bitmap;
  let image;
  let imageUrl;
  try {
    if ('createImageBitmap' in window) {
      bitmap = await createImageBitmap(file);
      image = bitmap;
    } else {
      imageUrl = URL.createObjectURL(file);
      image = new Image();
      image.src = imageUrl;
      await image.decode();
    }

    const width = image.width || image.naturalWidth;
    const height = image.height || image.naturalHeight;
    const longestSide = Math.max(width, height);
    if (longestSide <= 1500) return file;

    const scale = 1500 / longestSide;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Could not prepare this image for Safari.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const resizedBlob = await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not resize this image.')), 'image/jpeg', 0.92);
    });
    canvas.width = 0;
    canvas.height = 0;
    return new File([resizedBlob], file.name.replace(/\.[^.]+$/, '') + '-optimized.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  } finally {
    bitmap?.close?.();
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  }
}

async function removeImageBackground() {
  if (!sourceFile || removeButton.disabled) return;
  const thisJob = ++jobNumber;
  clearResult();
  errorMessage.hidden = true;
  overlay.hidden = false;
  removeButton.disabled = true;
  removeButton.textContent = 'Working…';
  progressTitle.textContent = isIOS ? 'Preparing a Safari-friendly image…' : 'Finding your subject…';
  progressDetail.textContent = 'Loading the background remover';
  progressBar.style.width = '4%';
  resultTag.textContent = 'WORKING';

  try {
    const imageToProcess = isIOS ? await makeIOSFriendlyImage(sourceFile) : sourceFile;
    if (thisJob !== jobNumber) return;

    // Keep Safari on the lightweight CPU/WASM path. On browsers where the
    // runtime is exposed globally, explicitly limit ONNX Runtime to one thread.
    if (useLightweightProcessing && globalThis.ort?.env?.wasm) {
      globalThis.ort.env.wasm.numThreads = 1;
      globalThis.ort.env.wasm.proxy = false;
    }

    const result = await removeBackground(imageToProcess, {
      model: useLightweightProcessing ? 'small' : 'medium',
      ...(useLightweightProcessing ? { device: 'cpu' } : {}),
      output: { format: 'image/png', quality: 1 },
      progress: (key, current, total) => {
        if (thisJob !== jobNumber) return;
        const percent = total > 0 ? Math.min(98, Math.round((current / total) * 100)) : 8;
        progressTitle.textContent = key.toLowerCase().includes('fetch') ? 'Getting the AI model…' : 'Finding your subject…';
        progressDetail.textContent = total > 0 ? `${percent}%` : 'Preparing image';
        progressBar.style.width = `${Math.max(4, percent)}%`;
      },
    });
    if (thisJob !== jobNumber) return;
    cutoutBlob = result;
    isSaved = false;
    updateUnloadWarning();
    resultUrl = URL.createObjectURL(result);
    resultImage.src = resultUrl;
    resultImage.hidden = false;
    emptyResult.hidden = true;
    overlay.hidden = true;
    resultTag.textContent = 'DONE';
    downloadButton.href = resultUrl;
    const baseName = sourceFile.name.replace(/\.[^.]+$/, '') || 'kwikkut-cutout';
    downloadButton.download = `${baseName}-cutout.png`;
    downloadButton.hidden = false;
    removeButton.hidden = true;
  } catch (error) {
    if (thisJob !== jobNumber) return;
    console.error('Background removal failed:', error);
    overlay.hidden = true;
    resultTag.textContent = 'TRY AGAIN';
    showError('We couldn’t remove the background this time. Check your connection and try again. The first run downloads the AI model.');
    removeButton.disabled = false;
    removeButton.textContent = 'Try again';
  }
}

function resetWorkspace() {
  jobNumber++;
  clearResult();
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceUrl = undefined;
  sourceFile = undefined;
  originalImage.removeAttribute('src');
  editor.hidden = true;
  dropZone.hidden = false;
  overlay.hidden = true;
  errorMessage.hidden = true;
  input.value = '';
}

input.addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (file) loadFile(file);
});
chooseAnotherButton.addEventListener('click', () => askBeforeDiscard(() => input.click()));
clearButton.addEventListener('click', () => askBeforeDiscard(resetWorkspace));
removeButton.addEventListener('click', removeImageBackground);
downloadButton.addEventListener('click', () => {
  if (!cutoutBlob) return;
  isSaved = true;
  updateUnloadWarning();
  document.querySelector('#saved-status').hidden = false;
});

document.querySelector('#unsaved-continue').addEventListener('click', () => {
  unsavedDialog.close();
  const action = pendingAction;
  pendingAction = undefined;
  action?.();
});
document.querySelector('#unsaved-save').addEventListener('click', () => {
  unsavedDialog.close();
  downloadButton.click();
  pendingAction = undefined;
});
document.querySelectorAll('[data-close-dialog]').forEach((button) => {
  button.addEventListener('click', () => button.closest('dialog').close());
});

dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    askBeforeDiscard(() => input.click());
  }
});
for (const eventName of ['dragenter', 'dragover']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('dragging');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragging');
  });
}
dropZone.addEventListener('drop', (event) => loadFile(event.dataTransfer?.files?.[0]));

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  installButton.hidden = false;
});
installButton.addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = undefined;
  installButton.hidden = true;
});
window.addEventListener('appinstalled', () => {
  installButton.hidden = true;
  installPrompt = undefined;
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((error) => {
      console.warn('KwikKut could not register its offline app shell:', error);
    });
  });
}
