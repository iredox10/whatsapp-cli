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

        const { version } = await fetchLatestBaileysVersion();

        this.socket = makeWASocket({
            version,
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            logger,
            browser: Browsers.ubuntu('Chrome'),
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            // Enable presence updates
            markOnlineOnConnect: true,
        });

        onEvents(this.socket.ev);

        // Track presence updates
        this.socket.ev.on('presence.update', (update: any) => {
            // This will be handled in the UI through onEvents if we pass it through
        });

        this.socket.ev.on('connection.update', (update: any) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                onQR(qr);
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    console.log('Connection lost, retrying in 5 seconds...');
                    setTimeout(() => {
                        this.init(onQR, onConnected, onEvents);
                    }, 5000);
                }
            } else if (connection === 'open') {
                onConnected();
            }
        });

        return this.socket;
    }

    async downloadMedia(message: any) {
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
    }

    async openMedia(filePath: string) {
        await open(filePath);
    }
}
