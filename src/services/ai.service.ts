import OpenAI from 'openai';
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import { db } from '../database/connection';

const baseUrls: Record<string, string> = {
    groq: 'https://api.groq.com/openai/v1',
    openai: 'https://api.openai.com/v1',
    openrouter: 'https://openrouter.ai/api/v1',
    '9router': 'http://127.0.0.1:20128/v1',
    gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/',
};

export interface AIProviderConfig {
    provider: string;
    apiKey: string;
    model: string;
    baseURL?: string;
}

export interface AIProviderStatus {
    provider: string;
    model: string;
    baseURL: string;
    configured: boolean;
    source: 'database' | 'env';
}

/** Membaca konfigurasi provider AI yang tersimpan di database. */
const readStoredConfig = async (): Promise<Partial<AIProviderConfig>> => {
    const keys = ['ai_provider', 'ai_api_key', 'ai_model', 'ai_base_url'];
    const [rows] = await db.execute(
        'SELECT `key`, value FROM settings WHERE `key` IN (?, ?, ?, ?)',
        keys,
    );
    const config = Object.fromEntries(
        (rows as Array<{ key: string; value: string }>).map(row => [row.key, row.value]),
    );
    return {
        provider: config.ai_provider,
        apiKey: config.ai_api_key,
        model: config.ai_model,
        baseURL: config.ai_base_url || undefined,
    };
};

/** Menggabungkan konfigurasi database dan environment untuk pemanggilan AI. */
const resolveConfig = async (): Promise<AIProviderConfig> => {
    const stored = await readStoredConfig();
    const configuredInDatabase = Boolean(stored.provider || stored.apiKey || stored.model);
    const provider = (stored.provider || process.env.AI_PROVIDER || 'groq').trim().toLowerCase();
    const baseURL = stored.baseURL?.trim()
        || (configuredInDatabase ? undefined : process.env.AI_BASE_URL?.trim())
        || baseUrls[provider];
    if (!baseURL) {
        throw new Error(`AI provider "${provider}" tidak dikenal. Atur provider lewat menu admin atau AI_BASE_URL.`);
    }

    const apiKey = stored.apiKey?.trim() || process.env.AI_API_KEY?.trim();
    if (!apiKey) {
        throw new Error(`API key AI belum diatur. Gunakan menu admin konfigurasi AI atau isi AI_API_KEY.`);
    }

    const model = stored.model?.trim() || process.env.AI_MODEL?.trim();
    if (!model) {
        throw new Error(`Model AI belum diatur. Gunakan menu admin konfigurasi AI atau isi AI_MODEL.`);
    }
    return { provider, apiKey, model, baseURL };
};

/** Mengambil status provider AI tanpa menampilkan API key. */
export const getAIProviderStatus = async (): Promise<AIProviderStatus> => {
    const stored = await readStoredConfig();
    const configuredInDatabase = Boolean(stored.provider || stored.apiKey || stored.model);
    const provider = (stored.provider || process.env.AI_PROVIDER || 'groq').trim().toLowerCase();
    const model = stored.model?.trim() || process.env.AI_MODEL?.trim() || 'belum diatur';
    const baseURL = stored.baseURL?.trim()
        || (configuredInDatabase ? undefined : process.env.AI_BASE_URL?.trim())
        || baseUrls[provider]
        || 'belum diatur';
    const configured = Boolean(
        (stored.apiKey?.trim() || process.env.AI_API_KEY?.trim()) &&
        model !== 'belum diatur' &&
        baseURL !== 'belum diatur',
    );
    return {
        provider,
        model,
        baseURL,
        configured,
        source: stored.provider || stored.apiKey || stored.model ? 'database' : 'env',
    };
};

/** Memvalidasi dan menyimpan konfigurasi provider AI ke database. */
export const saveAIProviderConfig = async (config: AIProviderConfig): Promise<void> => {
    const provider = config.provider.trim().toLowerCase();
    const apiKey = config.apiKey.trim();
    const model = config.model.trim();
    const baseURL = config.baseURL?.trim() || '';
    if (!provider || !apiKey || !model) {
        throw new Error('Provider, API key, dan model wajib diisi.');
    }
    if (!baseUrls[provider] && provider !== 'custom') {
        throw new Error(`Provider "${provider}" tidak didukung.`);
    }
    if ((provider === 'custom' || baseURL) && !/^https?:\/\/[^ ]+$/i.test(baseURL)) {
        throw new Error('Base URL harus berupa alamat HTTP/HTTPS yang valid.');
    }
    if (provider === 'custom' && !baseURL) {
        throw new Error('Base URL wajib untuk provider custom.');
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        for (const [key, value] of [
            ['ai_provider', provider],
            ['ai_api_key', apiKey],
            ['ai_model', model],
            ['ai_base_url', baseURL],
        ]) {
            await connection.execute(
                'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
                [key, value],
            );
        }
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
    clientCache = undefined;
}

let clientCache: { cacheKey: string; client: OpenAI } | undefined;

/** Membuat completion menggunakan provider AI yang telah dikonfigurasi. */
export const createAICompletion = async (
    params: Omit<ChatCompletionCreateParamsNonStreaming, 'model'> & { model?: string },
): Promise<ChatCompletion> => {
    const config = await resolveConfig();
    const cacheKey = `${config.provider}\0${config.baseURL}\0${config.apiKey}`;
    if (!clientCache || clientCache.cacheKey !== cacheKey) {
        clientCache = {
            cacheKey,
            client: new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL }),
        };
    }
    return clientCache.client.chat.completions.create({
        ...params,
        model: config.model,
    });
};

export const AI_MODEL = process.env.AI_MODEL?.trim() || 'configured-in-database';

export const openai = {
    chat: {
        completions: {
            create: createAICompletion,
        },
    },
};

export const AIService = {
    openai,
    model: AI_MODEL,
};
