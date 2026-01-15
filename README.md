# 📟 WhatsApp CLI (Bun + Ink)

[![Runtime](https://img.shields.io/badge/runtime-Bun-black?style=flat-square&logo=bun)](https://bun.sh)
[![Build](https://img.shields.io/badge/built%20with-Ink-blue?style=flat-square&logo=react)](https://github.com/vadimdemedes/ink)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

A high-performance, modern WhatsApp client built entirely for the terminal. Experience real-time messaging, group management, and media support with the speed of [Bun](https://bun.sh) and the beauty of [Ink](https://github.com/vadimdemedes/ink).

---

## ✨ Features

- **🚀 Lightning Fast:** Powered by Bun for near-instant startup and minimal resource usage.
- **🖥️ Full Dashboard:** A clean, three-pane layout featuring an interactive chat list, message history, and group member sidebar.
- **📁 Media Support:** 
    - **Download & Open:** Press `o` to instantly download and open the latest media in your system's default viewer.
    - **Send Files:** Send images and documents with a simple `/send <path>` command.
- **💬 Advanced Messaging:**
    - **Replying:** Select any message and press `r` to reply.
    - **Reactions:** React with ❤️ instantly by pressing `x` on any selected message.
- **👥 Group Management:** Toggle a real-time list of group members with `m`.
- **🔍 Instant Search:** Find any chat or group instantly with `/search <query>`.
- **🔐 Privacy & Persistence:**
    - **Local History:** Your chats and contacts are cached locally for offline viewing.
    - **Session Security:** Your authentication is stored securely in `.auth/`.
    - **Zero Tracking:** Fully open-source and respects your data.

---

## 🛠️ Installation

### Prerequisites
- [Bun](https://bun.sh) (v1.0.0 or higher)

### Setup
1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/whatsapp-cli.git
   cd whatsapp-cli
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Start the application:
   ```bash
   bun start
   ```

4. **Login:** Scan the generated QR code with your WhatsApp mobile app (**Linked Devices > Link a Device**).

---

## 🎮 Navigation & Controls

| Key | Action |
|-----|--------|
| `TAB` | Cycle focus between **Chats**, **Messages**, and **Input** |
| `j` / `k` or `↑` / `↓` | Navigate selected list (Chats or Messages) |
| `Enter` | Send message / Select |
| `r` | **Reply** to the highlighted message |
| `x` | **React** (❤️) to the highlighted message |
| `o` | **Open** latest media in the active chat |
| `m` | Toggle **Group Members** sidebar |
| `ESC` | Exit app / Clear Search / Cancel Reply |

### ⌨️ Commands
Type these in the input bar:
- `/search <name>` - Filter your chat list.
- `/send <path>` - Send a local file or image.

---

## 📁 Project Structure

```text
├── .auth/               # Authentication session tokens (Ignored by git)
├── .media/              # Local cache of downloaded files (Ignored by git)
├── src/
│   ├── index.tsx        # Application entry point
│   ├── whatsapp.ts      # Core WhatsApp logic & Baileys wrapper
│   └── ui/
│       └── App.tsx      # Main Ink Dashboard & React components
├── whatsapp_data.json   # Local persistent data (Ignored by git)
└── README.md            # You are here!
```

---

## 🔧 Troubleshooting

### "Try again later" on QR Scan
If WhatsApp prevents your login:
1. Exit the app (`ESC`).
2. Clear the session: `rm -rf .auth whatsapp_data.json`.
3. **Wait 10 minutes** (WhatsApp rate-limits connection attempts).
4. Restart and scan again.

### Media not opening
Ensure you have a default application set for the file type you are trying to open. The app uses the `open` package to trigger system defaults.

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
1. Fork the project.
2. Create your feature branch (`git checkout -b feature/AmazingFeature`).
3. Commit your changes (`git commit -m 'Add AmazingFeature'`).
4. Push to the branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.

---

<p align="center">Made with ❤️ for the terminal community.</p>
