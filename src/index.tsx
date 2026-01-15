import React from 'react';
import { render } from 'ink';
import { App } from './ui/App';
import fs from 'fs';
import path from 'path';

// Redirect specific annoying logs to a log file to keep the CLI UI clean
const logPath = path.join(process.cwd(), 'debug.log');
const logStream = fs.createWriteStream(logPath, { flags: 'a' });

const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

// @ts-ignore
process.stdout.write = (chunk, encoding, callback) => {
    const str = chunk.toString();
    if (str.includes('Closing session') || str.includes('SessionEntry')) {
        logStream.write('SUPPRESSED LOG: ' + str + '\n');
        return true;
    }
    return originalStdoutWrite(chunk, encoding, callback);
};

// @ts-ignore
process.stderr.write = (chunk, encoding, callback) => {
    const str = chunk.toString();
    if (str.includes('Closing session') || str.includes('SessionEntry')) {
        logStream.write('SUPPRESSED ERROR: ' + str + '\n');
        return true;
    }
    return originalStderrWrite(chunk, encoding, callback);
};

// Also redirect console methods to debug.log to prevent UI corruption
console.log = (...args) => { logStream.write(args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ') + '\n'); };
console.error = (...args) => { logStream.write('ERROR: ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ') + '\n'); };
console.warn = (...args) => { logStream.write('WARN: ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ') + '\n'); };

process.on('unhandledRejection', (reason, promise) => {
    logStream.write('Unhandled Rejection: ' + reason + '\n');
});

process.on('uncaughtException', (err) => {
    logStream.write('Uncaught Exception: ' + err.message + '\n' + err.stack + '\n');
});

render(<App />);
