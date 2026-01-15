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
    name?: string;
    lastMessage?: string;
    unreadCount?: number;
    isGroup?: boolean;
    presence?: string;
    groupMetadata?: any;
    timestamp?: number;
}

interface Contact {
    id: string;
    name?: string;
    notify?: string;
}

const DATA_FILE = path.join(process.cwd(), 'whatsapp_data.json');
const CONTACT_OVERRIDES_FILE = path.join(process.cwd(), 'contacts_overrides.json');

const ProgressBar = ({ percent, width = 20 }: { percent: number, width?: number }) => {
    const completed = Math.floor(width * Math.min(Math.max(percent, 0), 1));
    return (
        <Text>
            <Text color="green">{'█'.repeat(completed)}</Text>
            <Text color="gray">{'░'.repeat(width - completed)}</Text>
        </Text>
    );
};

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

const loadContactOverrides = () => {
    if (fs.existsSync(CONTACT_OVERRIDES_FILE)) {
        try {
            return fs.readJsonSync(CONTACT_OVERRIDES_FILE);
        } catch (e) {
            return {};
        }
    }
    return {};
};

export const App = () => {
    const { exit } = useApp();
    const initialData = useRef(loadInitialData()).current;
    const initialOverrides = useRef(loadContactOverrides()).current;

    const [qrCodeString, setQrCodeString] = useState<string | null>(null);
    const [connected, setConnected] = useState(false);
    const [chats, setChats] = useState<Chat[]>(initialData.chats || []);
    const [contacts, setContacts] = useState<Record<string, Contact>>(initialData.contacts || {});
    const [messages, setMessages] = useState<Record<string, Message[]>>(initialData.messages || {});
    const [contactOverrides, setContactOverrides] = useState<Record<string, string>>(initialOverrides || {});
    const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
    const [input, setInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [client, setClient] = useState<WhatsAppClient | null>(null);
    const [chatOffset, setChatOffset] = useState(0);
    const [focusedPane, setFocusedPane] = useState<'input' | 'chats' | 'messages' | 'members'>('input');
    const [selectedMessageIndex, setSelectedMessageIndex] = useState(-1);
    const [replyingTo, setReplyingTo] = useState<Message | null>(null);
    const [showMembers, setShowMembers] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncProgress, setSyncProgress] = useState(0);
    const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    
    const CHATS_PER_PAGE = 15;

    // Helper to format messages
    const formatMessage = useCallback((msg: any) => {
        const content = msg.message;
        if (!content) return null;

        let text = '';
        let replyTo = undefined;

        const msgType = Object.keys(content)[0];
        if (!msgType) return null;

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

    const normalizeJid = useCallback((jid: string) => {
        if (!jid) return jid;
        if (jid.endsWith('@c.us')) return jid.replace('@c.us', '@s.whatsapp.net');
        if (jid.endsWith('@s.whatsapp.net')) return jid;
        return jid;
    }, []);

    const getContactById = useCallback((jid: string) => {
        const normalized = normalizeJid(jid);
        return contacts[jid] || contacts[normalized] || contacts[jid.replace('@s.whatsapp.net', '@c.us')];
    }, [contacts, normalizeJid]);

    const looksLikeMemberList = useCallback((name?: string) => {
        if (!name) return false;
        return name.includes(',') || name.includes(';');
    }, []);

    // Helper to get the best display name for a chat or participant
    const getDisplayName = useCallback((id: string, chatName?: string, groupSubject?: string) => {
        if (!id) return 'Unknown';
        const normalizedId = normalizeJid(id);
        const contact = getContactById(normalizedId);
        const isGroup = normalizedId.endsWith('@g.us');

        // 0. Manual overrides always win
        if (contactOverrides[normalizedId]) return contactOverrides[normalizedId];

        // 1. Check phone contacts name
        if (contact?.name && !looksLikeMemberList(contact.name)) return contact.name;

        // 2. Check WhatsApp push name (for individuals)
        if (!isGroup && contact?.notify) return contact.notify;

        // 3. Group subject (prefer metadata subject if present)
        if (isGroup) {
            if (groupSubject && !looksLikeMemberList(groupSubject)) return groupSubject;
            if (chatName && !looksLikeMemberList(chatName) && !chatName.includes('@')) return chatName;
            return 'Group';
        }

        // 4. Use non-numeric chatName for individuals if available
        if (chatName && !/^[\d\s+()-]+$/.test(chatName) && !looksLikeMemberList(chatName)) return chatName;

        // 5. Fallback to ID/Number (stripped)
        return normalizedId.split('@')[0];
    }, [getContactById, looksLikeMemberList, normalizeJid, contactOverrides]);

    const updateChatList = useCallback((chatId: string, update: Partial<Chat>) => {
        setChats(prev => {
            const index = prev.findIndex(c => c.id === chatId);
            const isGroup = chatId.endsWith('@g.us');
            
            if (index !== -1) {
                const existing = prev[index];
                const updated = { ...existing, ...update };
                
                // Keep group names stable unless metadata update
                if (isGroup && update.name && !update.groupMetadata && !update.isGroup) {
                    if (!looksLikeMemberList(update.name)) {
                        updated.name = existing.name || update.name;
                    }
                } else {
                    if (!isGroup || !looksLikeMemberList(update.name)) {
                        updated.name = update.name || existing.name;
                    }
                }
                
                if (update.lastMessage) {
                    return [updated, ...prev.filter(c => c.id !== chatId)];
                }
                const next = [...prev];
                next[index] = updated;
                return next.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            } else {
                return [{
                    id: chatId,
                    name: update.name,
                    lastMessage: update.lastMessage || '',
                    unreadCount: update.unreadCount || 0,
                    isGroup,
                    timestamp: update.timestamp || Math.floor(Date.now() / 1000),
                    ...update
                }, ...prev].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            }
        });
    }, []);


    const updateContacts = useCallback((newContacts: Contact[]) => {
        setContacts(prev => {
            const next = { ...prev };
            for (const c of newContacts) {
                const normalizedId = normalizeJid(c.id);
                next[normalizedId] = { ...next[normalizedId], ...c, id: normalizedId };
                next[c.id] = { ...next[c.id], ...c, id: c.id };
            }
            return next;
        });
    }, [normalizeJid]);

    useEffect(() => {
        if (!client) return;
        
        const onPresence = ({ id, presences }: any) => {
            const presence = Object.values(presences)[0] as any;
            if (presence) {
                setChats(prev => prev.map(c => 
                    c.id === id ? { ...c, presence: presence.lastKnownPresence } : c
                ));
            }
        };

        client.socket.ev.on('presence.update', onPresence);
        return () => {
            if (client && client.socket) client.socket.ev.off('presence.update', onPresence);
        };
    }, [client]);

    useEffect(() => {
        if (!client || !selectedChatId || !selectedChatId.endsWith('@g.us')) return;
        
        const chat = chats.find(c => c.id === selectedChatId);
        if (chat?.groupMetadata) return;

        client.socket.groupMetadata(selectedChatId).then((metadata: any) => {
            updateChatList(selectedChatId, { groupMetadata: metadata, name: metadata.subject });
        }).catch((e: any) => {
            if (e.data !== 403) {
                console.error(`Metadata fetch failed for ${selectedChatId}: ${e.message}`);
            }
        });
    }, [client, selectedChatId, updateChatList, chats]);

    useEffect(() => {
        const interval = setInterval(() => {
            try {
                fs.writeJsonSync(DATA_FILE, { chats, contacts, messages });
                fs.writeJsonSync(CONTACT_OVERRIDES_FILE, contactOverrides);
            } catch (e) {}
        }, 15000);
        return () => clearInterval(interval);
    }, [chats, contacts, messages, contactOverrides]);

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
                ev.on('messaging-history.set', ({ chats: newChats, contacts: newContacts, isLatest }: any) => {
                    setIsSyncing(true);
                    setSyncProgress(prev => Math.min(prev + 0.2, 0.9));
                    for (const c of newChats) {
                        updateChatList(c.id, { 
                            name: c.name || c.subject || c.pushName,
                            unreadCount: c.unreadCount,
                            isGroup: c.id.endsWith('@g.us'),
                            timestamp: c.conversationTimestamp || c.timestamp
                        });
                    }
                    updateContacts(newContacts);
                    if (isLatest) {
                        setSyncProgress(1);
                        setTimeout(() => {
                            setIsSyncing(false);
                            setSyncProgress(0);
                        }, 2000);
                    }
                });

                ev.on('chats.set', ({ chats: newChats }: any) => {
                    for (const c of newChats) {
                        updateChatList(c.id, { 
                            name: c.name || c.subject || c.pushName,
                            unreadCount: c.unreadCount,
                            isGroup: c.id.endsWith('@g.us'),
                            timestamp: c.conversationTimestamp || c.timestamp
                        });
                    }
                });

                ev.on('chats.upsert', (newChats: any) => {
                    for (const c of newChats) {
                        updateChatList(c.id, { 
                            name: c.name || c.subject || c.pushName,
                            isGroup: c.id.endsWith('@g.us'),
                            timestamp: c.conversationTimestamp || c.timestamp
                        });
                    }
                });

                ev.on('chats.update', (updates: any) => {
                    for (const u of updates) {
                        updateChatList(u.id, u);
                    }
                });

                ev.on('contacts.set', ({ contacts: newContacts }: any) => {
                    updateContacts(newContacts);
                });

                ev.on('contacts.upsert', (newContacts: any) => {
                    updateContacts(newContacts);
                });

                ev.on('contacts.update', (updates: any) => {
                    updateContacts(updates);
                });

                ev.on('messages.upsert', async (m: any) => {
                    if (m.type === 'notify') {
                        for (const msg of m.messages) {
                            const chatId = msg.key.remoteJid;
                            if (!chatId) continue;
                            
                            // Capture push name
                            if (msg.pushName) {
                                const contactId = msg.key.participant || chatId;
                                updateContacts([{ id: contactId, notify: msg.pushName }]);
                                // Ensure chat name uses push name when no contact name exists
                                updateChatList(chatId, { name: msg.pushName });
                            }

                            const formatted = formatMessage(msg);
                            if (!formatted) continue;

                            setMessages(prev => ({
                                ...prev,
                                [chatId]: [...(prev[chatId] || []).slice(-49), formatted]
                            }));

                            updateChatList(chatId, { 
                                lastMessage: formatted.text,
                                timestamp: formatted.timestamp
                            });

                            
                            if (!msg.key.fromMe) {
                                setChats(prev => prev.map(c => 
                                    c.id === chatId ? { ...c, unreadCount: (c.unreadCount || 0) + 1 } : c
                                ));
                            }
                        }
                    }
                });
            }
        ).then(() => setClient(wa)).catch((e) => {});
    }, [formatMessage, updateChatList, updateContacts]);

    useEffect(() => {
        if (selectedChatId && client && connected) {
            client.socket.readMessages([ { remoteJid: selectedChatId, id: undefined, fromMe: false } ]).catch(() => {});
            setChats(prev => prev.map(c => c.id === selectedChatId ? { ...c, unreadCount: 0 } : c));
            setSelectedMessageIndex(-1);
            setReplyingTo(null);
            setErrorMsg(null);
        }
    }, [selectedChatId, client, connected]);

    const filteredChats = chats.filter(chat => {
        if (!searchQuery) return true;
        const name = getDisplayName(chat.id, chat.name).toLowerCase();
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
                client.socket.sendMessage(selectedChatId, {
                    react: { text: '❤️', key: currentMessages[selectedMessageIndex].raw.key }
                }).catch((e: Error) => setErrorMsg('React error: ' + e.message));
            }
        }

        if (input === 'm' && selectedChat?.isGroup) {
            setShowMembers(!showMembers);
            setFocusedPane(showMembers ? 'input' : 'members');
        }

        if (input === 'o' && selectedChatId && client) {
            const lastMedia = [...currentMessages].reverse().find(m => m.text.startsWith('[') && m.text.endsWith(']'));
            if (lastMedia) {
                setDownloadingFile(lastMedia.text);
                client.downloadMedia(lastMedia.raw).then(path => {
                    setDownloadingFile(null);
                    if (path) client.openMedia(path);
                }).catch(() => setDownloadingFile(null));
            }
        }
    });

    const sendMessage = async () => {
        if (!input || !client) return;
        setErrorMsg(null);

        if (input.startsWith('/search ')) {
            setSearchQuery(input.replace('/search ', '').trim());
            setInput('');
            return;
        }
        if (input === '/clear') {
            try {
                if (fs.existsSync(DATA_FILE)) fs.removeSync(DATA_FILE);
            } catch (e) {}
            setChats([]);
            setContacts({});
            setMessages({});
            setSyncProgress(0);
            setIsSyncing(true);
            return;
        }

        if (input.startsWith('/alias ')) {
            const parts = input.replace('/alias ', '').trim().split(' ');
            const number = parts.shift();
            const name = parts.join(' ').trim();
            if (number && name) {
                const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
                const normalized = normalizeJid(jid);
                setContactOverrides(prev => ({ ...prev, [normalized]: name }));
                setInput('');
                return;
            }
        }

        if (input === '/logout') {
            if (client) {
                await client.logout();
            }
            fs.removeSync(DATA_FILE);
            if (fs.existsSync(CONTACT_OVERRIDES_FILE)) fs.removeSync(CONTACT_OVERRIDES_FILE);
            exit();
            return;
        }

        if (input.startsWith('/unalias ')) {
            const number = input.replace('/unalias ', '').trim();
            if (number) {
                const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
                const normalized = normalizeJid(jid);
                setContactOverrides(prev => {
                    const next = { ...prev };
                    delete next[normalized];
                    return next;
                });
                setInput('');
                return;
            }
        }
        if (!selectedChatId) return;

        try {
            if (input.startsWith('/send ')) {
                const filePath = input.replace('/send ', '').trim();
                if (await fs.pathExists(filePath)) {
                    const isImage = filePath.match(/\.(jpg|jpeg|png|gif)$/i);
                    await client.socket.sendMessage(selectedChatId, { 
                        [isImage ? 'image' : 'document']: { url: filePath },
                        mimetype: isImage ? 'image/jpeg' : 'application/octet-stream',
                        fileName: filePath.split('/').pop()
                    });
                } else {
                    setErrorMsg('File not found');
                }
            } else {
                const payload: any = { text: input };
                if (replyingTo) {
                    await client.socket.sendMessage(selectedChatId, payload, { quoted: replyingTo.raw });
                    setReplyingTo(null);
                } else {
                    await client.socket.sendMessage(selectedChatId, payload);
                }
            }
        } catch (err: any) {
            setErrorMsg('Send failed: ' + (err.message || 'Unknown error'));
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

    if (!connected) return (
        <Box padding={1} flexDirection="column" alignItems="center">
            <Text>Connecting to WhatsApp...</Text>
            <Box marginTop={1}>
                <ProgressBar percent={0.3} width={30} />
            </Box>
        </Box>
    );

    return (
        <Box flexDirection="column" height="100%">
            <Box borderStyle="round" borderColor="green" paddingX={1} justifyContent="space-between">
                <Box flexDirection="column" flexGrow={1}>
                    <Box justifyContent="space-between">
                        <Text bold color="green">WhatsApp CLI</Text>
                        <Text dimColor>Focus: {focusedPane} | TAB: Switch | ESC: Exit | r: Reply | x: React | m: Members</Text>
                    </Box>
                    {isSyncing && (
                        <Box marginTop={0}>
                            <Text color="yellow">Syncing History: </Text>
                            <ProgressBar percent={syncProgress} width={20} />
                            <Text color="yellow"> {Math.round(syncProgress * 100)}%</Text>
                        </Box>
                    )}
                </Box>
            </Box>

            <Box flexDirection="row" flexGrow={1}>
                {/* Chats Sidebar */}
                <Box flexDirection="column" width="25%" borderStyle="single" borderColor={focusedPane === 'chats' ? 'blue' : 'gray'} paddingX={1}>
                    <Box justifyContent="space-between">
                        <Text bold underline>Chats ({filteredChats.length})</Text>
                        {searchQuery && <Text color="yellow"> [Q]</Text>}
                    </Box>
                    {filteredChats.length === 0 && (
                        <Box padding={1} flexDirection="column" alignItems="center">
                            <Text dimColor>{connected ? "Syncing your chats..." : "Connecting..."}</Text>
                            <Box marginTop={1}>
                                <ProgressBar percent={syncProgress || 0.1} width={20} />
                            </Box>
                        </Box>
                    )}
                    {filteredChats.slice(chatOffset, chatOffset + CHATS_PER_PAGE).map(chat => {
                        const isSelected = selectedChatId === chat.id;
                        const isOnline = !chat.isGroup && chat.presence === 'available';
                        const groupSubject = chat.groupMetadata?.subject;
                        const displayName = getDisplayName(chat.id, chat.name, groupSubject);

                        return (
                            <Box key={chat.id} backgroundColor={isSelected ? 'blue' : undefined} paddingX={1}>
                                <Text color={isSelected ? 'white' : (isOnline ? 'green' : undefined)} wrap="truncate-end">
                                    {isSelected ? '> ' : '  '}{chat.isGroup ? '[G] ' : (isOnline ? '● ' : '○ ')}{displayName}
                                </Text>
                            </Box>
                        );
                    })}

                </Box>

                {/* Messages Pane */}
                <Box flexDirection="column" width={showMembers ? "50%" : "75%"} borderStyle="single" borderColor={focusedPane === 'messages' ? 'blue' : 'gray'} paddingX={1}>
                    <Box borderStyle="single" borderColor="cyan" paddingX={1} marginBottom={1} justifyContent="space-between">
                        <Text bold color="cyan">{getDisplayName(selectedChatId || '', selectedChat?.name, selectedChat?.groupMetadata?.subject)}</Text>
                        <Text dimColor>{selectedChat?.presence || ''}</Text>
                    </Box>
                    <Box flexDirection="column" flexGrow={1}>
                        {currentMessages.slice(-20).map((m, i) => {
                            const actualIndex = currentMessages.length > 20 ? i + (currentMessages.length - 20) : i;
                            const isMessageFocused = focusedPane === 'messages' && actualIndex === selectedMessageIndex;
                            
                            const sender = m.isMe ? 'You' : getDisplayName(m.raw?.key?.participant || m.from, m.raw?.pushName);

                            
                            return (
                                <Box key={m.id} flexDirection="column" marginBottom={1} backgroundColor={isMessageFocused ? 'white' : undefined}>
                                    {m.replyTo && (
                                        <Box borderStyle="single" borderColor="gray" paddingX={1} marginLeft={2}>
                                            <Text dimColor italic size="small">{getDisplayName(m.replyTo.participant)}: {m.replyTo.text}</Text>
                                        </Box>
                                    )}
                                    <Box>
                                        <Text color={isMessageFocused ? 'black' : (m.isMe ? 'green' : 'yellow')} bold>{sender}:</Text>
                                        <Text color={isMessageFocused ? 'black' : undefined}> {m.text}</Text>
                                    </Box>
                                </Box>
                            );
                        })}
                    </Box>

                    {errorMsg && (
                        <Box borderStyle="single" borderColor="red" paddingX={1}>
                            <Text color="red" bold>Error: {errorMsg}</Text>
                        </Box>
                    )}

                    {downloadingFile && (
                        <Box borderStyle="single" borderColor="blue" paddingX={1}>
                            <Text color="blue">Downloading {downloadingFile}... </Text>
                            <ProgressBar percent={0.5} width={10} />
                        </Box>
                    )}

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
                            <Text key={p.id}>• {getDisplayName(p.id)} {p.admin ? '(Admin)' : ''}</Text>
                        ))}
                    </Box>
                )}
            </Box>
        </Box>
    );
};
