import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { WhatsAppClient } from '../whatsapp';
import qrcode from 'qrcode-terminal';
import fs from 'fs-extra';
import path from 'path';

interface Message {
    id: string;
    from: string;
    text: string;
    timestamp: number;
    isMe: boolean;
    raw?: any;
    replyTo?: {
        text: string;
        participant: string;
    };
}

interface Chat {
    id: string;
    name: string;
    lastMessage?: string;
    unreadCount?: number;
    isGroup?: boolean;
    presence?: string;
    groupMetadata?: any;
}

interface Contact {
    id: string;
    name?: string;
    notify?: string;
}

const DATA_FILE = path.join(process.cwd(), 'whatsapp_data.json');

const loadInitialData = () => {
    if (fs.existsSync(DATA_FILE)) {
        try {
            return fs.readJsonSync(DATA_FILE);
        } catch (e) {
            return {};
        }
    }
    return {};
};

export const App = () => {
    const { exit } = useApp();
    const initialData = useRef(loadInitialData()).current;

    const [qrCodeString, setQrCodeString] = useState<string | null>(null);
    const [connected, setConnected] = useState(false);
    const [chats, setChats] = useState<Chat[]>(initialData.chats || []);
    const [contacts, setContacts] = useState<Record<string, Contact>>(initialData.contacts || {});
    const [messages, setMessages] = useState<Record<string, Message[]>>(initialData.messages || {});
    const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
    const [input, setInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [client, setClient] = useState<WhatsAppClient | null>(null);
    const [chatOffset, setChatOffset] = useState(0);
    const [focusedPane, setFocusedPane] = useState<'input' | 'chats' | 'messages' | 'members'>('input');
    const [selectedMessageIndex, setSelectedMessageIndex] = useState(-1);
    const [replyingTo, setReplyingTo] = useState<Message | null>(null);
    const [showMembers, setShowMembers] = useState(false);
    
    const CHATS_PER_PAGE = 15;

    // Presence & Group Meta listeners
    useEffect(() => {
        if (!client) return;
        
        const onPresence = ({ id, presences }: any) => {
            const presence = Object.values(presences)[0] as any;
            setChats(prev => prev.map(c => 
                c.id === id ? { ...c, presence: presence.lastKnownPresence } : c
            ));
        };

        client.socket.ev.on('presence.update', onPresence);
        return () => client.socket.ev.off('presence.update', onPresence);
    }, [client]);

    useEffect(() => {
        if (!client || !selectedChatId || !selectedChatId.endsWith('@g.us')) return;
        client.socket.groupMetadata(selectedChatId).then((metadata: any) => {
            setChats(prev => prev.map(c => 
                c.id === selectedChatId ? { ...c, groupMetadata: metadata } : c
            ));
        });
    }, [client, selectedChatId]);

    // Save data
    useEffect(() => {
        const interval = setInterval(() => {
            try {
                fs.writeJsonSync(DATA_FILE, { chats, contacts, messages });
            } catch (e) {}
        }, 15000);
        return () => clearInterval(interval);
    }, [chats, contacts, messages]);

    const formatMessage = useCallback((msg: any) => {
        const content = msg.message;
        if (!content) return null;

        let text = '';
        let replyTo = undefined;

        const msgType = Object.keys(content)[0];
        const m = content[msgType];

        if (content.conversation) text = content.conversation;
        else if (content.extendedTextMessage) {
            text = content.extendedTextMessage.text;
            if (content.extendedTextMessage.contextInfo?.quotedMessage) {
                const quoted = content.extendedTextMessage.contextInfo.quotedMessage;
                replyTo = {
                    text: quoted.conversation || quoted.extendedTextMessage?.text || '[Media]',
                    participant: content.extendedTextMessage.contextInfo.participant
                };
            }
        } else {
            text = `[${msgType?.replace('Message', '') || 'Media'}]`;
        }

        return {
            id: msg.key.id,
            from: msg.key.remoteJid,
            text,
            timestamp: msg.messageTimestamp,
            isMe: msg.key.fromMe,
            raw: msg,
            replyTo
        };
    }, []);

    const updateChatList = useCallback((chatId: string, update: Partial<Chat>) => {
        setChats(prev => {
            const index = prev.findIndex(c => c.id === chatId);
            if (index !== -1) {
                const existing = prev[index];
                const updated = { ...existing, ...update };
                if (update.lastMessage) return [updated, ...prev.filter(c => c.id !== chatId)];
                const next = [...prev];
                next[index] = updated;
                return next;
            } else {
                return [{
                    id: chatId,
                    name: update.name || chatId.split('@')[0],
                    lastMessage: update.lastMessage || '',
                    unreadCount: update.unreadCount || 0,
                    isGroup: chatId.endsWith('@g.us'),
                    ...update
                }, ...prev];
            }
        });
    }, []);

    useEffect(() => {
        const wa = new WhatsAppClient();
        wa.init(
            (newQr) => {
                qrcode.generate(newQr, { small: true }, (code) => {
                    setQrCodeString(code);
                });
            },
            () => setConnected(true),
            (ev) => {
                ev.on('messaging-history.set', ({ chats: newChats, contacts: newContacts }: any) => {
                    for (const c of newChats) updateChatList(c.id, { name: c.name, unreadCount: c.unreadCount });
                    setContacts(prev => {
                        const next = { ...prev };
                        for (const c of newContacts) next[c.id] = c;
                        return next;
                    });
                });

                ev.on('messages.upsert', async (m: any) => {
                    if (m.type === 'notify') {
                        for (const msg of m.messages) {
                            const chatId = msg.key.remoteJid;
                            if (!chatId) continue;
                            const formatted = formatMessage(msg);
                            if (!formatted) continue;

                            setMessages(prev => ({
                                ...prev,
                                [chatId]: [...(prev[chatId] || []).slice(-49), formatted]
                            }));

                            updateChatList(chatId, { lastMessage: formatted.text, name: msg.pushName });
                            if (!msg.key.fromMe) {
                                setChats(prev => prev.map(c => c.id === chatId ? { ...c, unreadCount: (c.unreadCount || 0) + 1 } : c));
                            }
                        }
                    }
                });
            }
        ).then(() => setClient(wa));
    }, [formatMessage, updateChatList]);

    useEffect(() => {
        if (selectedChatId && client && connected) {
            client.socket.readMessages([ { remoteJid: selectedChatId, id: undefined, fromMe: false } ]).catch(() => {});
            setChats(prev => prev.map(c => c.id === selectedChatId ? { ...c, unreadCount: 0 } : c));
            setSelectedMessageIndex(-1);
            setReplyingTo(null);
        }
    }, [selectedChatId, client, connected]);

    const filteredChats = chats.filter(chat => {
        if (!searchQuery) return true;
        const contact = contacts[chat.id];
        const name = (contact?.name || contact?.notify || chat.name || '').toLowerCase();
        return name.includes(searchQuery.toLowerCase());
    });

    const currentMessages = selectedChatId ? messages[selectedChatId] || [] : [];
    const selectedChat = chats.find(c => c.id === selectedChatId);

    useInput((input, key) => {
        if (key.escape) {
            if (replyingTo) setReplyingTo(null);
            else if (showMembers) setShowMembers(false);
            else if (searchQuery) setSearchQuery('');
            else exit();
        }

        if (key.tab) {
            const order: any[] = ['input', 'chats', 'messages'];
            if (showMembers) order.push('members');
            const idx = order.indexOf(focusedPane);
            setFocusedPane(order[(idx + 1) % order.length]);
            return;
        }

        // Navigation
        if (focusedPane === 'chats' || focusedPane === 'input') {
            if (key.upArrow || input === 'k') {
                const index = filteredChats.findIndex(c => c.id === selectedChatId);
                if (index > 0) {
                    setSelectedChatId(filteredChats[index - 1].id);
                    if (index - 1 < chatOffset) setChatOffset(index - 1);
                }
            }
            if (key.downArrow || input === 'j') {
                const index = filteredChats.findIndex(c => c.id === selectedChatId);
                if (index < filteredChats.length - 1) {
                    setSelectedChatId(filteredChats[index + 1].id);
                    if (index + 1 >= chatOffset + CHATS_PER_PAGE) setChatOffset(index + 1 - CHATS_PER_PAGE + 1);
                }
            }
        }

        if (focusedPane === 'messages' && currentMessages.length > 0) {
            if (key.upArrow || input === 'k') {
                setSelectedMessageIndex(prev => prev === -1 ? currentMessages.length - 1 : Math.max(0, prev - 1));
            }
            if (key.downArrow || input === 'j') {
                setSelectedMessageIndex(prev => prev === -1 ? currentMessages.length - 1 : Math.min(currentMessages.length - 1, prev + 1));
            }
            if (input === 'r' && selectedMessageIndex !== -1) {
                setReplyingTo(currentMessages[selectedMessageIndex]);
                setFocusedPane('input');
            }
            if (input === 'x' && selectedMessageIndex !== -1 && client) {
                // Quick reaction menu or just a heart for now
                client.socket.sendMessage(selectedChatId, {
                    react: { text: '❤️', key: currentMessages[selectedMessageIndex].raw.key }
                });
            }
        }

        if (input === 'm' && selectedChat?.isGroup) {
            setShowMembers(!showMembers);
            setFocusedPane(showMembers ? 'input' : 'members');
        }

        if (input === 'o' && selectedChatId && client) {
            const lastMedia = [...currentMessages].reverse().find(m => m.text.startsWith('[') && m.text.endsWith(']'));
            if (lastMedia) client.downloadMedia(lastMedia.raw).then(path => path && client.openMedia(path));
        }
    });

    const sendMessage = async () => {
        if (!input || !client) return;
        if (input.startsWith('/search ')) {
            setSearchQuery(input.replace('/search ', '').trim());
            setInput('');
            return;
        }
        if (!selectedChatId) return;

        if (input.startsWith('/send ')) {
            const filePath = input.replace('/send ', '').trim();
            if (await fs.pathExists(filePath)) {
                const isImage = filePath.match(/\.(jpg|jpeg|png|gif)$/i);
                await client.socket.sendMessage(selectedChatId, { 
                    [isImage ? 'image' : 'document']: { url: filePath },
                    mimetype: isImage ? 'image/jpeg' : 'application/octet-stream',
                    fileName: filePath.split('/').pop()
                });
            }
        } else {
            const payload: any = { text: input };
            if (replyingTo) {
                payload.quoted = replyingTo.raw;
                setReplyingTo(null);
            }
            await client.socket.sendMessage(selectedChatId, payload);
        }
        setInput('');
    };

    if (qrCodeString && !connected) {
        return (
            <Box flexDirection="column" alignItems="center" padding={1}>
                <Text color="green" bold>Scan QR Code to Login</Text>
                <Box marginTop={1} borderStyle="single" borderColor="white" padding={1}><Text>{qrCodeString}</Text></Box>
            </Box>
        );
    }

    if (!connected) return <Box padding={1}><Text>Connecting to WhatsApp...</Text></Box>;

    return (
        <Box flexDirection="column" height="100%">
            <Box borderStyle="round" borderColor="green" paddingX={1} justifyContent="space-between">
                <Text bold color="green">WhatsApp CLI</Text>
                <Text dimColor>Focus: {focusedPane} | TAB: Switch | ESC: Exit | r: Reply | x: React | m: Members</Text>
            </Box>

            <Box flexDirection="row" flexGrow={1}>
                {/* Chats Sidebar */}
                <Box flexDirection="column" width="25%" borderStyle="single" borderColor={focusedPane === 'chats' ? 'blue' : 'gray'} paddingX={1}>
                    <Text bold underline>Chats ({filteredChats.length})</Text>
                    {filteredChats.slice(chatOffset, chatOffset + CHATS_PER_PAGE).map(chat => {
                        const contact = contacts[chat.id];
                        const displayName = chat.name || contact?.name || chat.id.split('@')[0];
                        const isSelected = selectedChatId === chat.id;
                        const isOnline = chat.presence === 'available';

                        return (
                            <Box key={chat.id} backgroundColor={isSelected ? 'blue' : undefined} paddingX={1}>
                                <Text color={isSelected ? 'white' : (isOnline ? 'green' : undefined)}>
                                    {isSelected ? '> ' : '  '}{chat.isGroup ? '[G] ' : (isOnline ? '● ' : '○ ')}{displayName}
                                </Text>
                            </Box>
                        );
                    })}
                </Box>

                {/* Messages Pane */}
                <Box flexDirection="column" width={showMembers ? "50%" : "75%"} borderStyle="single" borderColor={focusedPane === 'messages' ? 'blue' : 'gray'} paddingX={1}>
                    <Box borderStyle="single" borderColor="cyan" paddingX={1} marginBottom={1} justifyContent="space-between">
                        <Text bold color="cyan">{selectedChat?.name || selectedChatId}</Text>
                        <Text dimColor>{selectedChat?.presence || ''}</Text>
                    </Box>
                    <Box flexDirection="column" flexGrow={1}>
                        {currentMessages.slice(-20).map((m, i) => {
                            const isSelected = focusedPane === 'messages' && i === selectedMessageIndex;
                            const sender = m.isMe ? 'You' : (contacts[m.raw?.key?.participant || m.from]?.name || m.raw?.pushName || 'Other');
                            return (
                                <Box key={m.id} flexDirection="column" marginBottom={1} backgroundColor={isSelected ? 'white' : undefined}>
                                    {m.replyTo && (
                                        <Box borderStyle="single" borderColor="gray" paddingX={1} marginLeft={2}>
                                            <Text dimColor italic size="small">{contacts[m.replyTo.participant]?.name || 'Member'}: {m.replyTo.text}</Text>
                                        </Box>
                                    )}
                                    <Box>
                                        <Text color={isSelected ? 'black' : (m.isMe ? 'green' : 'yellow')} bold>{sender}:</Text>
                                        <Text color={isSelected ? 'black' : undefined}> {m.text}</Text>
                                    </Box>
                                </Box>
                            );
                        })}
                    </Box>

                    {replyingTo && (
                        <Box borderStyle="single" borderColor="yellow" paddingX={1}>
                            <Text color="yellow">Replying to {replyingTo.text}</Text>
                        </Box>
                    )}

                    <Box borderStyle="single" borderColor={focusedPane === 'input' ? 'cyan' : 'gray'} paddingX={1} marginTop={1}>
                        <Text color="cyan" bold>{'> '}</Text>
                        <TextInput value={input} onChange={setInput} onSubmit={sendMessage} placeholder="Message..." focus={focusedPane === 'input'} />
                    </Box>
                </Box>

                {/* Members Sidebar */}
                {showMembers && selectedChat?.groupMetadata && (
                    <Box flexDirection="column" width="25%" borderStyle="single" borderColor={focusedPane === 'members' ? 'blue' : 'gray'} paddingX={1}>
                        <Text bold underline>Members ({selectedChat.groupMetadata.participants.length})</Text>
                        {selectedChat.groupMetadata.participants.slice(0, 30).map((p: any) => (
                            <Text key={p.id}>• {contacts[p.id]?.name || p.id.split('@')[0]} {p.admin ? '(Admin)' : ''}</Text>
                        ))}
                    </Box>
                )}
            </Box>
        </Box>
    );
};
