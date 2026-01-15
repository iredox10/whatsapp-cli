# WhatsApp CLI (Bun + Ink)

A high-performance WhatsApp client for your terminal.

## Features
- **Dashboard UI:** Three-pane layout for chats and messages.
- **Authentication:** Scan QR code in terminal.
- **Media Support:** 
    - Press `o` to open the last media message in the selected chat.
    - Use `/send <path>` to send images or documents.
- **Persistence:** Sessions and media are saved locally.
- **Real-time:** Instant updates for incoming messages.

## Installation
Ensure you have [Bun](https://bun.sh) installed.

```bash
bun install
```

## Usage
```bash
bun start
```

## Navigation
- **Arrows Up/Down:** Navigate through your chat list.
- **ESC:** Exit the application.
- **'o' key:** Download and open the most recent media in the active chat.
- **Type message + Enter:** Send a text message.
- **`/send path/to/file` + Enter:** Send a file.

## Troubleshooting
### "Try again later" on QR Scan
If you see "Try again later" when scanning the QR code:
1. Exit the app (`ESC`).
2. Run `rm -rf .auth whatsapp_data.json` to clear the stuck session.
3. Wait at least 5-10 minutes before trying again. WhatsApp sometimes rate-limits connection attempts.
4. Ensure your phone has a stable internet connection.
5. If it persists, try using a different network (e.g., mobile hotspot).
