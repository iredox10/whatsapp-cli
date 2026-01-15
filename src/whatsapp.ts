import makeWASocket, { 
    DisconnectReason, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    WAConnectionState,
    downloadContentFromMessage,
    MediaType,
    Browsers
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import path from 'path';
import fs from 'fs-extra';
import qrcode from 'qrcode-terminal';
import open from 'open';

// Completely silent logger
const logger = pino({ level: 'silent' });

export class WhatsAppClient {
    public socket: any;
    private state: any;
    private saveCreds: any;
    private sessionPath: string;
    private mediaPath: string;

    constructor() {
        this.sessionPath = path.resolve(process.cwd(), '.auth');
        this.mediaPath = path.resolve(process.cwd(), '.media');
        fs.ensureDirSync(this.mediaPath);
    }

    async init(onQR: (qr: string) => void, onConnected: () => void, onEvents: (ev: any) => void) {
        const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);
        this.state = state;
        this.saveCreds = saveCreds;

        const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

        this.socket = makeWASocket({
            version,
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            logger,
            browser: Browsers.macOS('Chrome'),
            generateHighQualityLinkPreview: true,
            syncFullHistory: true, // Re-enabled to ensure all chats and groups are fetched
            markOnlineOnConnect: true,
            retryRequestDelayMs: 5000,
        });

        this.socket.ev.on('creds.update', saveCreds);
        onEvents(this.socket.ev);

        this.socket.ev.on('connection.update', (update: any) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                onQR(qr);
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    setTimeout(() => {
                        this.init(onQR, onConnected, onEvents).catch(() => {});
                    }, 5000);
                }
            } else if (connection === 'open') {
                onConnected();
            }
        });

        return this.socket;
    }

    async downloadMedia(message: any) {
        try {
            const messageType = Object.keys(message.message || {})[0];
            const msg = message.message[messageType];
            
            if (!msg?.directPath && !msg?.url) return null;

            const stream = await downloadContentFromMessage(msg, messageType.replace('Message', '') as MediaType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }

            const fileName = `${message.key.id}_${msg.fileName || 'file'}`;
            const filePath = path.join(this.mediaPath, fileName);
            await fs.writeFile(filePath, buffer);
            return filePath;
        } catch (e) {
            return null;
        }
    }

    async openMedia(filePath: string) {
        await open(filePath).catch(() => {});
    }

    async logout() {
        if (this.socket) {
            await this.socket.logout().catch(() => {});
            this.socket.end(undefined);
        }
        await fs.remove(this.sessionPath).catch(() => {});
    }
}
