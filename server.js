const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Railway sits in front of the app: the real address and protocol come from
// its proxy headers. Needed for the Secure cookie and the per-visitor limits.
app.set('trust proxy', 1);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- POSTGRESQL DATABASE CONNECTION ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// --- KASI DELIVERY (the delivery system behind this app) ---
// This app compiles the order. Kasi Delivery does everything after it, on
// WhatsApp: who it is for, where it goes, the delivery fee, the invoice, the
// payment and the driver. KASI_API_KEY is the key Kasi Delivery issued for
// this app. It is used from this server only and never sent to a browser.
// Without it, checkout falls back to opening WhatsApp with the order typed.
const KASI_API_URL = (process.env.KASI_API_URL || 'https://api.easybranding.co.za/api/v1').replace(/\/+$/, '');
const KASI_API_KEY = process.env.KASI_API_KEY || '';

// --- PERMANENT FILE STORAGE SETUP ---
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

app.use('/uploads', (req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); }, express.static(UPLOADS_DIR));

// Photos only. The extension decides the Content-Type a file is served with,
// so an uploaded .html page would otherwise run as this website.
const IMAGE_TYPES = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif'];

const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, UPLOADS_DIR); },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname).toLowerCase());
    }
});
const upload = multer({
    storage: storage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: function (req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        if (/^image\//.test(file.mimetype) && IMAGE_TYPES.includes(ext)) cb(null, true);
        else cb(new Error('Only photos can be uploaded (JPG, PNG, WEBP or HEIC).'));
    }
});

// A small in-memory limit per visitor. Enough to stop somebody guessing the
// admin password, filling the disk with uploads, or flooding the order list.
function rateLimit(max, windowMs) {
    const hits = new Map();
    return (req, res, next) => {
        const now = Date.now();
        const recent = (hits.get(req.ip) || []).filter(t => now - t < windowMs);
        if (recent.length >= max) return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
        recent.push(now);
        hits.set(req.ip, recent);
        next();
    };
}

// Customers attach photos to parcel and furniture requests, so this stays
// open to visitors. What keeps it safe is the filter above and this limit.
app.post('/api/upload', rateLimit(120, 10 * 60 * 1000), (req, res) => {
    upload.single('file')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Each photo must be smaller than 8 MB.' : err.message });
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        res.json({ url: `/uploads/${req.file.filename}` });
    });
});

// Default Database Structure
const defaultConfig = {
    // The first login. ADMIN_PASSWORD on Railway sets it for a new database;
    // without it the password is admin123 and the first login is told to
    // change it. Passwords are stored as hashes (see hashPassword below).
    users: [{ username: 'admin', password: process.env.ADMIN_PASSWORD || 'admin123' }],
    siteContent: {
        websiteName: "KasiDeliveries",
        websiteLogo: null,
        whatsappNumber: "27843689501", 
        callNumber: "0613642449",
        email: "support@kasideliveries.co.za",
        about: "KasiDeliveries is your trusted local delivery partner. We connect you with your favourite food, groceries, and transport services.",
        contact: "WhatsApp: 0843689501\nCall: 0613642449\nEmail: support@kasideliveries.co.za",
        terms: "By using KasiDeliveries, you agree to our terms of service. Prices are estimates and confirmed on WhatsApp.",
        privacy: "We respect your privacy. Your personal details are only used for delivery purposes and are never shared with third parties."
    },
    sliderImages: [],
    categories: {
        takeaways: 'https://images.unsplash.com/photo-1561758033-d89a9ad46330?q=80&w=800',
        groceries: 'https://images.unsplash.com/photo-1542838132-92c53300491e?q=80&w=800',
        parcels: 'https://z-cdn-media.chatglm.cn/files/3ae72811-047f-45bb-a218-01a2173fc2eb.png',
        furniture: 'https://images.unsplash.com/photo-1600518464441-9154a4dea21b?q=80&w=800',
        track: 'https://z-cdn-media.chatglm.cn/files/b848b1a4-672d-4af8-9061-d08b344fd863.png',
        van: 'https://images.unsplash.com/photo-1597007030739-6d2e7172ee5b?q=80&w=800',
        bakkie: 'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?q=80&w=800',
        truck: 'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?q=80&w=800',
        send_parcel: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?q=80&w=800',
        collect_parcel: 'https://images.unsplash.com/photo-1597306622489-5c80aa3c55e3?q=80&w=800'
    },
    takeaways: {
        franchises: [
            { id: 'kfc', name: 'KFC', logo: '🍗', logoImg: null, categoryImages: {}, menu: [{ id: 'k1', name: 'Family Meal', price: 180, img: null }, { id: 'k2', name: 'Zinger Wings (6)', price: 65, img: null }]},
            { id: 'deb', name: 'Debonairs', logo: '🍕', logoImg: null, categoryImages: {}, menu: [{ id: 'd1', name: 'Large Margherita', price: 120, img: null }, { id: 'd2', name: 'Triple Decker', price: 150, img: null }]}
        ],
        local: [
            { id: 'kasigrill', name: 'Kasi Grill', logo: '🔥', logoImg: null, categoryImages: {}, menu: [{ id: 'kg1', name: 'Kota & Chips', price: 45, img: null }, { id: 'kg2', name: 'Russian & Chips', price: 35, img: null }]}
        ]
    },
    groceries: [
        { id: 'shoprite', name: 'Shoprite', logo: '🛒', logoImg: null, categoryImages: {}, menu: [{ id: 's1', name: 'Milk 2L', price: 35, img: null }, { id: 's2', name: 'Bread', price: 15, img: null }]},
        { id: 'mamaspaza', name: 'Mama Spaza', logo: '🏪', logoImg: null, categoryImages: {}, menu: [{ id: 'ms1', name: 'Cold Drink 2L', price: 20, img: null }]}
    ]
};

// --- ADMIN LOGIN ---
// The password check happens HERE, on the server. It used to happen in the
// visitor's browser, against a list of usernames and passwords that
// /api/data sent to everybody who opened the website.
//
// A password is stored as a scrypt hash, never as itself. One saved as plain
// text before this change is hashed the first time the server starts.
const DEFAULT_PASSWORD = 'admin123';
const MAX_USERS = 20;
const MIN_PASSWORD = 8;

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    return `scrypt$${salt}$${crypto.scryptSync(String(password), salt, 64).toString('hex')}`;
}

function checkPassword(password, hash) {
    if (typeof hash !== 'string' || !hash.startsWith('scrypt$')) return false;
    const [, salt, digest] = hash.split('$');
    const given = crypto.scryptSync(String(password), salt, 64);
    const kept = Buffer.from(digest, 'hex');
    return given.length === kept.length && crypto.timingSafeEqual(given, kept);
}

// Returns true when a plain-text password was found and replaced by its hash.
function hashStoredPasswords(config) {
    let changed = false;
    for (const user of config.users || []) {
        if (user.password && !user.hash) {
            user.hash = hashPassword(user.password);
            // Remembered so the first login can be told to change it, without
            // keeping the password itself.
            if (user.password === DEFAULT_PASSWORD) user.isDefault = true;
            changed = true;
        }
        if ('password' in user) { delete user.password; changed = true; }
    }
    return changed;
}

const SESSION_COOKIE = 'kd_admin';
const SESSION_MS = 12 * 60 * 60 * 1000;
const sessions = new Map(); // token -> { username, expires }. A restart signs everybody out.

function readCookie(req, name) {
    const found = String(req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith(name + '='));
    return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

function setSessionCookie(req, res, token, maxAgeMs) {
    const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
    if (req.secure) parts.push('Secure');
    res.set('Set-Cookie', parts.join('; '));
}

// Who is logged in on this request, or null.
function adminOf(req) {
    const token = readCookie(req, SESSION_COOKIE);
    const session = token && sessions.get(token);
    if (!session) return null;
    if (session.expires < Date.now()) { sessions.delete(token); return null; }
    return session.username;
}

function requireAdmin(req, res, next) {
    if (!adminOf(req)) return res.status(401).json({ error: 'Please log in again.' });
    next();
}

// --- DATABASE HELPERS ---
async function loadConfig() {
    const result = await pool.query('SELECT data FROM app_state WHERE id = 1');
    return result.rows[0].data;
}

async function saveConfigData(config) {
    await pool.query('UPDATE app_state SET data = $1 WHERE id = 1', [JSON.stringify(config)]);
}

// Initialize Database Tables
async function initDB() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS app_state (id INT PRIMARY KEY, data JSONB);
            CREATE TABLE IF NOT EXISTS orders (ref TEXT PRIMARY KEY, type TEXT, details JSONB, total NUMERIC, date TEXT, status TEXT);
            CREATE TABLE IF NOT EXISTS parcel_requests (ref TEXT PRIMARY KEY, type TEXT, details JSONB, date TEXT, status TEXT);
            CREATE TABLE IF NOT EXISTS furniture_requests (ref TEXT PRIMARY KEY, vehicle TEXT, details JSONB, date TEXT, status TEXT);
        `);

        const stateRes = await client.query('SELECT data FROM app_state WHERE id = 1');
        if (stateRes.rows.length === 0) {
            const fresh = JSON.parse(JSON.stringify(defaultConfig));
            hashStoredPasswords(fresh);
            await client.query('INSERT INTO app_state (id, data) VALUES (1, $1)', [JSON.stringify(fresh)]);
        } else {
            // A database from before this change holds passwords as plain text.
            const config = stateRes.rows[0].data;
            if (!Array.isArray(config.users)) config.users = [];
            if (hashStoredPasswords(config)) {
                await client.query('UPDATE app_state SET data = $1 WHERE id = 1', [JSON.stringify(config)]);
                console.log('Admin passwords are now stored as hashes.');
            }
        }
    } finally {
        client.release();
    }
}

// When something happened, in South African time, in a form that sorts and
// that every browser can read back: 2026-10-13 14:05
function nowStamp() {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date()).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// One line of plain text, cut to a length.
function clean(value, max) {
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// --- KASI DELIVERY CLIENT ---
// Never throws: a delivery system that is slow or down must not take the
// website down with it. { ok, status, data } either way.
async function kasi(method, pathname, body) {
    try {
        const res = await fetch(KASI_API_URL + pathname, {
            method,
            headers: { 'Authorization': `Bearer ${KASI_API_KEY}`, 'Accept': 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(8000)
        });
        const data = await res.json().catch(() => null);
        return { ok: res.ok && data && data.success === true, status: res.status, data: data || {} };
    } catch (err) {
        console.error(`Kasi Delivery ${method} ${pathname} failed: ${err.message}`);
        return { ok: false, status: 0, data: {} };
    }
}

// What an order's state means to a person, from what Kasi Delivery says.
function describeBasket(basket) {
    if (!basket) return { status: 'Unknown', done: false };
    if (basket.status === 'pending') return { status: 'Waiting for you to send it on WhatsApp', done: false, whatsappLink: basket.whatsappLink };
    if (basket.status === 'claimed') return { status: 'Being completed on WhatsApp', done: false };
    if (basket.status === 'expired') return { status: 'Not completed (the order code expired)', done: true };
    const d = basket.delivery || {};
    const words = {
        delivered: 'Delivered', failed: 'Not delivered', arrived: 'The driver has arrived',
        on_the_way: 'The driver is on the way', collected: 'Collected from the shop', assigned: 'A driver has the order'
    };
    let status = words[d.status];
    if (!status) {
        if (d.shopAnswer === 'rejected' || d.shopAnswer === 'no_answer') status = 'The shop could not take the order';
        else if (d.shopAnswer !== 'accepted') status = 'Waiting for the shop to accept';
        else if (d.paymentStatus !== 'paid') status = 'Waiting for payment';
        else status = 'Paid. Finding a driver';
    }
    return {
        status,
        done: ['delivered', 'failed'].includes(d.status) || ['rejected', 'no_answer'].includes(d.shopAnswer),
        deliveryReference: d.reference || null,
        trackingUrl: d.trackingUrl || null,
        total: d.total == null ? null : d.total
    };
}

// The admin's order list shows where each order has got to. Only the recent,
// unfinished ones are asked about, a few at a time, so opening the dashboard
// stays quick however long the list grows.
async function refreshOrderStatuses(orders) {
    if (!KASI_API_KEY) return;
    const open = orders.filter(o => o.details && o.details.kasiCode && !o.details.done).slice(0, 15);
    await Promise.all(open.map(async (order) => {
        const result = await kasi('GET', `/baskets/${encodeURIComponent(order.details.kasiCode)}`);
        if (!result.ok) return;
        const state = describeBasket(result.data.basket);
        if (state.status === order.status && Boolean(state.done) === Boolean(order.details.done)) return;
        order.status = state.status;
        order.details = { ...order.details, done: state.done, deliveryReference: state.deliveryReference || null };
        await pool.query('UPDATE orders SET status = $1, details = $2 WHERE ref = $3', [order.status, JSON.stringify(order.details), order.ref]);
    }));
}

// --- WHAT A VISITOR GETS, AND WHAT AN ADMIN GETS ---
// A visitor gets the website: content, images, stores and menus. NEVER the
// admin users, and never anybody's orders. Those go to a logged-in admin only.
app.get('/api/data', async (req, res) => {
    try {
        let config = await loadConfig();

        let needsSave = false;
        for(let key in defaultConfig) {
            if(key !== 'users' && !config.hasOwnProperty(key)) { config[key] = defaultConfig[key]; needsSave = true; }
        }
        if(!config.siteContent.hasOwnProperty('websiteName')) { config.siteContent.websiteName = "KasiDeliveries"; needsSave = true; }
        if(!config.siteContent.hasOwnProperty('websiteLogo')) { config.siteContent.websiteLogo = null; needsSave = true; }
        if(!config.siteContent.hasOwnProperty('whatsappNumber')) { config.siteContent.whatsappNumber = "27843689501"; needsSave = true; }
        if(!config.siteContent.hasOwnProperty('callNumber')) { config.siteContent.callNumber = "0613642449"; needsSave = true; }
        if(!config.siteContent.hasOwnProperty('email')) { config.siteContent.email = "support@kasideliveries.co.za"; needsSave = true; }

        // Auto-migrate new categories
        if(!config.categories.hasOwnProperty('van')) { config.categories.van = defaultConfig.categories.van; needsSave = true; }
        if(!config.categories.hasOwnProperty('bakkie')) { config.categories.bakkie = defaultConfig.categories.bakkie; needsSave = true; }
        if(!config.categories.hasOwnProperty('truck')) { config.categories.truck = defaultConfig.categories.truck; needsSave = true; }
        if(!config.categories.hasOwnProperty('send_parcel')) { config.categories.send_parcel = defaultConfig.categories.send_parcel; needsSave = true; }
        if(!config.categories.hasOwnProperty('collect_parcel')) { config.categories.collect_parcel = defaultConfig.categories.collect_parcel; needsSave = true; }

        // FIX: Used 'config' instead of 'appData' to prevent server crash
        allStores(config).forEach(s => { if(!s.categoryImages) s.categoryImages = {}; });

        if(needsSave) await saveConfigData(config);

        const { users, ...site } = config;
        const shared = { ...site, kasiDelivery: Boolean(KASI_API_KEY) };

        const admin = adminOf(req);
        if (!admin) {
            return res.json({ ...shared, isAdmin: false, users: [], orders: [], parcelRequests: [], furnitureRequests: [] });
        }

        const ordersRes = await pool.query('SELECT ref, type, details, total, date, status FROM orders ORDER BY date DESC');
        const parcelsRes = await pool.query('SELECT ref, type, details, date, status FROM parcel_requests ORDER BY date DESC');
        const furnitureRes = await pool.query('SELECT ref, vehicle, details, date, status FROM furniture_requests ORDER BY date DESC');
        await refreshOrderStatuses(ordersRes.rows);

        res.json({
            ...shared,
            isAdmin: true,
            adminUser: admin,
            // Usernames only. The password box in User Management is for
            // typing a NEW password; nothing can show the current one.
            users: (users || []).map(u => ({ username: u.username, password: '' })),
            orders: ordersRes.rows.map(r => ({ ...r, total: parseFloat(r.total) })),
            parcelRequests: parcelsRes.rows,
            furnitureRequests: furnitureRes.rows.map(r => ({ ref: r.ref, ...r.details, date: r.date, status: r.status }))
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

app.post('/api/admin/login', rateLimit(10, 15 * 60 * 1000), async (req, res) => {
    try {
        const username = clean(req.body && req.body.username, 60);
        const password = String((req.body && req.body.password) || '');
        const config = await loadConfig();
        const user = (config.users || []).find(u => u.username === username);
        if (!user || !checkPassword(password, user.hash)) return res.status(401).json({ error: 'Invalid credentials' });

        const token = crypto.randomBytes(32).toString('hex');
        sessions.set(token, { username: user.username, expires: Date.now() + SESSION_MS });
        setSessionCookie(req, res, token, SESSION_MS);
        res.json({ success: true, username: user.username, mustChangePassword: user.isDefault === true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Could not log in' });
    }
});

app.post('/api/admin/logout', (req, res) => {
    sessions.delete(readCookie(req, SESSION_COOKIE));
    setSessionCookie(req, res, '', 0);
    res.json({ success: true });
});

// The users the admin screen sent, merged onto the ones stored. The screen
// never holds a current password, so: a blank password keeps the user's
// existing one, and anything typed becomes their new one.
function mergeUsers(stored, sent) {
    if (!Array.isArray(sent) || sent.length === 0) throw new Error('Keep at least one admin user.');
    if (sent.length > MAX_USERS) throw new Error(`There can be at most ${MAX_USERS} users.`);
    const seen = new Set();
    return sent.map((entry) => {
        const username = clean(entry && entry.username, 40);
        if (!/^[A-Za-z0-9._-]{2,40}$/.test(username)) throw new Error('A username is 2 to 40 letters, numbers, dots, dashes or underscores.');
        if (seen.has(username.toLowerCase())) throw new Error(`There are two users called ${username}.`);
        seen.add(username.toLowerCase());

        const existing = stored.find(u => u.username === username);
        const password = String((entry && entry.password) || '');
        if (!password) {
            if (!existing) throw new Error(`Set a password for ${username}.`);
            return existing;
        }
        if (password.length < MIN_PASSWORD) throw new Error(`A password needs at least ${MIN_PASSWORD} characters.`);
        if (password === DEFAULT_PASSWORD) throw new Error('Choose a password other than the default one.');
        return { username, hash: hashPassword(password) };
    });
}

// Only an admin can change the website. This used to accept anything from
// anybody, including a new list of admin users.
app.post('/api/config', requireAdmin, async (req, res) => {
    try {
        const sent = req.body || {};
        const config = await loadConfig();

        // Only the parts the admin screens own. Anything else in the request
        // is ignored, so a stray field cannot be planted in the database.
        for (const key of ['siteContent', 'sliderImages', 'categories', 'takeaways', 'groceries']) {
            if (sent[key] !== undefined) config[key] = sent[key];
        }

        // The WhatsApp number is used to build wa.me links, which need the
        // country code and nothing else. "084 368 9501" typed in the admin is
        // saved as 27843689501, or every WhatsApp button would go nowhere.
        if (config.siteContent && config.siteContent.whatsappNumber != null) {
            const digits = String(config.siteContent.whatsappNumber).replace(/\D/g, '');
            config.siteContent.whatsappNumber = /^0\d{9}$/.test(digits) ? '27' + digits.slice(1) : digits;
        }

        const stored = Array.isArray(config.users) ? config.users : [];
        if (sent.users !== undefined) {
            const before = new Map(stored.map(u => [u.username, u.hash]));
            config.users = mergeUsers(stored, sent.users);
            const after = new Map(config.users.map(u => [u.username, u.hash]));
            if (!after.has(adminOf(req))) throw new Error('You cannot remove the user you are logged in as.');

            // Anybody removed, or whose password changed, is signed out
            // everywhere except on the screen that just made the change.
            const thisSession = readCookie(req, SESSION_COOKIE);
            for (const [token, session] of sessions) {
                if (token === thisSession) continue;
                if (after.get(session.username) !== before.get(session.username)) sessions.delete(token);
            }
        }

        await saveConfigData(config);
        res.status(200).json({ message: 'Config saved successfully' });
    } catch (err) {
        if (/user|password|username/i.test(err.message)) return res.status(400).json({ error: err.message });
        console.error(err);
        res.status(500).json({ error: 'Failed to save config' });
    }
});

// --- CHECKOUT ---
// The browser says WHICH items and how many. The prices are looked up here,
// from the menus in the database, so a price cannot be changed in the page.

function allStores(config) {
    return [
        ...((config.takeaways && config.takeaways.franchises) || []),
        ...((config.takeaways && config.takeaways.local) || []),
        ...(config.groceries || [])
    ];
}

// One line of a basket, priced the way the menu page shows it: the sale price
// when the item is on sale, plus whatever the chosen option adds.
function priceLine(store, line) {
    const item = (store.menu || []).find(i => String(i.id) === String(line.itemId));
    if (!item) throw new Error(`${store.name} no longer has one of the items in your cart. Please remove it and try again.`);

    const qty = Number(line.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new Error(`You can order 1 to 20 of ${item.name}.`);

    const base = parseFloat(item.price);
    const sale = parseFloat(item.salePrice);
    let price = item.onSale && sale > 0 ? sale : base;
    // An item with no price on its menu is refused, never sold for nothing.
    if (!Number.isFinite(price) || price < 0) throw new Error(`${item.name} has no price yet, so it cannot be ordered.`);

    const option = clean(line.option, 80);
    if (option) {
        const choice = String(item.options || '').split(',').map(o => o.split('|')).find(([name]) => clean(name, 80) === option);
        if (!choice) throw new Error(`${item.name} no longer comes with "${option}". Please add it to your cart again.`);
        price += parseFloat(choice[1]) || 0;
    } else if (item.options) {
        throw new Error(`Please choose an option for ${item.name}.`);
    }

    const name = item.name + (option ? ` (${option})` : '') + (item.size ? ` ${item.size}` : '');
    return { sku: clean(String(item.id) + (option ? '_' + option : ''), 60), name: clean(name, 80), qty, unitPrice: Math.round(price * 100) / 100 };
}

const kasiRefusal = {
    store_closed: (store) => `${store} is not taking orders right now.`,
    store_not_found: (store) => `${store} cannot take delivery orders yet.`,
    delivery_fee_not_set: () => 'Ordering is not available right now. Please try again later.'
};

app.post('/api/checkout', rateLimit(150, 60 * 60 * 1000), async (req, res) => {
    try {
        const lines = Array.isArray(req.body && req.body.items) ? req.body.items : [];
        if (lines.length === 0) return res.status(400).json({ error: 'Your cart is empty.' });
        if (lines.length > 80) return res.status(400).json({ error: 'That is too many different items for one order.' });

        const config = await loadConfig();
        const stores = allStores(config);

        // One basket per shop: each shop is its own collection and delivery.
        const byStore = new Map();
        for (const line of lines) {
            // Compared tidied on both sides: a store saved as "Good Hope
            // Restaurant " (a space on the end) is still that store.
            const storeName = clean(line && line.store, 120);
            const store = stores.find(s => clean(s.name, 120) === storeName);
            if (!store) return res.status(400).json({ error: `${storeName || 'A shop in your cart'} is no longer listed. Please remove its items.` });
            if (store.isOnline === false) return res.status(409).json({ error: `${store.name} is offline right now. Please remove its items and try again.` });
            if (!byStore.has(store)) byStore.set(store, []);
            try { byStore.get(store).push(priceLine(store, line)); }
            catch (err) { return res.status(400).json({ error: err.message }); }
        }

        const stamp = Date.now();
        const results = [];
        let n = 0;
        for (const [store, items] of byStore) {
            n += 1;
            const ref = byStore.size === 1 ? `KD-${stamp}` : `KD-${stamp}-${n}`;
            const itemsTotal = Math.round(items.reduce((sum, i) => sum + i.qty * i.unitPrice, 0) * 100) / 100;
            const order = { ref, store: store.name, items, itemsTotal };

            if (KASI_API_KEY) {
                const sentToKasi = await kasi('POST', '/baskets', {
                    // A shop's Kasi Delivery id when it has been set, else its name.
                    ...(store.kasiShopId ? { vendorId: store.kasiShopId } : { store: clean(store.name, 120) }),
                    reference: ref,
                    items
                });
                if (!sentToKasi.ok) {
                    const reason = kasiRefusal[sentToKasi.data.error];
                    if (!reason) console.error(`Kasi Delivery refused basket ${ref}: ${sentToKasi.status} ${sentToKasi.data.error || ''} ${sentToKasi.data.message || ''}`);
                    results.push({ ...order, error: reason ? reason(store.name) : 'Ordering is not available right now. Please try again in a minute.' });
                    continue;
                }
                const basket = sentToKasi.data.basket;
                order.kasiCode = basket.code;
                order.whatsappLink = basket.whatsappLink;
                order.deliveryFee = basket.deliveryFee;
            }

            await pool.query('INSERT INTO orders (ref, type, details, total, date, status) VALUES ($1, $2, $3, $4, $5, $6)', [
                ref, 'Food/Grocery Order',
                JSON.stringify({ store: store.name, items, kasiCode: order.kasiCode || null, done: false }),
                itemsTotal, nowStamp(),
                order.kasiCode ? 'Waiting for the customer on WhatsApp' : 'Awaiting WhatsApp Confirmation'
            ]);
            results.push(order);
        }

        res.json({ orders: results, kasiDelivery: Boolean(KASI_API_KEY) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Could not start your order. Please try again.' });
    }
});

// The old way in: the browser sent the whole order, total included, and it
// was saved as it came. Checkout is /api/checkout now.
app.post('/api/order', (req, res) => {
    res.status(410).json({ error: 'Please refresh the page and check out again.' });
});

// Where an order has got to. The order number is all a customer has, so it is
// all this needs, and it gives back nothing about who placed the order.
app.get('/api/track/:ref', rateLimit(150, 10 * 60 * 1000), async (req, res) => {
    try {
        const ref = clean(req.params.ref, 60).toUpperCase();
        const found = await pool.query('SELECT ref, details, status FROM orders WHERE UPPER(ref) = $1', [ref]);
        if (found.rows.length === 0) return res.status(404).json({ error: 'We could not find an order with that number.' });

        const order = found.rows[0];
        const details = order.details || {};
        if (!details.kasiCode || !KASI_API_KEY) return res.json({ ref: order.ref, store: details.store || null, status: order.status });

        const result = await kasi('GET', `/baskets/${encodeURIComponent(details.kasiCode)}`);
        if (!result.ok) return res.json({ ref: order.ref, store: details.store || null, status: order.status });
        const state = describeBasket(result.data.basket);
        res.json({ ref: order.ref, store: details.store || null, status: state.status, trackingUrl: state.trackingUrl || null, whatsappLink: state.whatsappLink || null });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Could not look that order up. Please try again.' });
    }
});

// --- PARCEL AND FURNITURE REQUESTS ---
// These come from visitors, so only what a request needs is kept: short text
// fields and photos that were uploaded here. The date and the status are set
// by the server, not taken from the browser.

function requestDetails(details) {
    const kept = {};
    for (const [key, value] of Object.entries(details && typeof details === 'object' ? details : {}).slice(0, 20)) {
        if (key === 'images') continue;
        kept[clean(key, 40)] = clean(value, 600);
    }
    kept.images = (Array.isArray(details && details.images) ? details.images : [])
        .filter(url => typeof url === 'string' && /^\/uploads\/[A-Za-z0-9._-]+$/.test(url))
        .slice(0, 10);
    return kept;
}

const requestLimit = rateLimit(60, 60 * 60 * 1000);

app.post('/api/parcel', requestLimit, async (req, res) => {
    const { ref, type, details } = req.body || {};
    if (!/^KD-(SEND|COLL)-\d{10,16}$/.test(String(ref || ''))) return res.status(400).json({ error: 'That request could not be read. Please try again.' });
    try {
        await pool.query('INSERT INTO parcel_requests (ref, type, details, date, status) VALUES ($1, $2, $3, $4, $5)',
            [ref, type === 'Collect Parcel' ? 'Collect Parcel' : 'Send Parcel', JSON.stringify(requestDetails(details)), nowStamp(), 'New Request']);
        res.status(200).json({ message: 'Parcel saved' });
    } catch (err) { res.status(500).json({ error: 'Failed to save parcel' }); }
});

app.post('/api/furniture', requestLimit, async (req, res) => {
    const { ref, vehicle, details } = req.body || {};
    if (!/^KD-FURN-\d{10,16}$/.test(String(ref || ''))) return res.status(400).json({ error: 'That request could not be read. Please try again.' });
    try {
        await pool.query('INSERT INTO furniture_requests (ref, vehicle, details, date, status) VALUES ($1, $2, $3, $4, $5)',
            [ref, clean(vehicle, 40), JSON.stringify(requestDetails(details)), nowStamp(), 'Quotation Requested']);
        res.status(200).json({ message: 'Furniture saved' });
    } catch (err) { res.status(500).json({ error: 'Failed to save furniture' }); }
});

// An address under /api that does not exist is an error, not the home page.
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// A request that could not be read (broken JSON, for one) gets a short
// answer, not Express's page with the server's file paths in it.
app.use((err, req, res, next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.status === 400 || err.status === 413 ? 'That request could not be read.' : 'Something went wrong. Please try again.' });
});

initDB().then(() => {
    app.listen(PORT, () => {
        console.log(`KasiDeliveries Server running on port ${PORT} with PostgreSQL and File Uploads`);
        console.log(KASI_API_KEY ? 'Kasi Delivery: connected (orders are finished on WhatsApp).' : 'Kasi Delivery: KASI_API_KEY is not set, so checkout only opens WhatsApp with the order typed.');
    });
}).catch(err => {
    console.error('Database initialization failed', err);
    process.exit(1);
});
