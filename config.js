import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = __dirname;
export const DATA_DIR = join(__dirname, 'data');
export const PUBLIC_DIR = join(__dirname, 'public');
export const PORT = parseInt(process.env.PORT || '3000', 10);

export const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

export const MODELS = [
  { id: 'meta/llama-3.1-8b-instruct',         label: '⚡ Llama 3.1 8B (Fast)', default: true },
  { id: 'mistralai/mistral-medium-3.5-128b',  label: '🧠 Mistral Medium 3.5' },
  { id: 'mistralai/mistral-large-2411',        label: '🔬 Mistral Large 2411' },
  { id: 'meta/llama-3.3-70b-instruct',         label: '🦙 Llama 3.3 70B' },
];

export const FALLBACK_MODEL = 'meta/llama-3.1-8b-instruct';
