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

let sourceFile;
let sourceUrl;
let resultUrl;
let installPrompt;
let jobNumber = 0;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clearResult() {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = undefined;
  resultImage.removeAttribute('src');
  resultImage.hidden = true;
  emptyResult.hidden = false;
  downloadButton.hidden = true;
  resultTag.textContent = 'READY';
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
  jobNumber++;
  sourceFile = file;
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceUrl = URL.createObjectURL(file);
  originalImage.src = sourceUrl;
  originalName.textContent = file.name;
  fileDetails.textContent = `${file.name} · ${formatBytes(file.size)}`;
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

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

async function removeImageBackground() {
  if (!sourceFile || removeButton.disabled) return;
  const thisJob = ++jobNumber;
  clearResult();
  errorMessage.hidden = true;
  overlay.hidden = false;
  removeButton.disabled = true;
  removeButton.textContent = 'Working…';
  progressTitle.textContent = 'Finding your subject…';
  progressDetail.textContent = 'Loading the background remover';
  progressBar.style.width = '4%';
  resultTag.textContent = 'WORKING';

  try {
    const result = await removeBackground(sourceFile, {
      model: 'medium',
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

input.addEventListener('change', (event) => loadFile(event.target.files?.[0]));
document.querySelector('#choose-another').addEventListener('click', () => input.click());
removeButton.addEventListener('click', removeImageBackground);

dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    input.click();
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
