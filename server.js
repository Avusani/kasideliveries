const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- POSTGRESQL DATABASE CONNECTION ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// --- PERMANENT FILE STORAGE SETUP ---
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

// Create uploads folder if it doesn't exist
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Serve the uploaded images permanently
app.use('/uploads', express.static(UPLOADS_DIR));

// Configure Multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOADS_DIR);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// API: Handle File Uploads
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ url: `/uploads/${req.file.filename}` });
});

// Default Database Structure
const defaultConfig = {
    users: [{ username: 'admin', password: 'admin123' }],
    siteContent: {
        about: "KasiDeliveries is your trusted local delivery partner. We connect you with your favourite food, groceries, and transport services.",
        contact: "WhatsApp: 0712345678\nEmail: support@kasideliveries.co.za",
        terms: "By using KasiDeliveries, you agree to our terms of service. Prices are estimates and confirmed on WhatsApp.",
        privacy: "We respect your privacy. Your personal details are only used for delivery purposes and are never shared with third parties."
    },
    sliderImages: [], // Up to 3 images
    categories: {
        takeaways: 'https://images.unsplash.com/photo-1561758033-d89a9ad46330?q=80&w=800',
        groceries: 'https://images.unsplash.com/photo-1542838132-92c53300491e?q=80&w=800',
        parcels: 'https://z-cdn-media.chatglm.cn/files/3ae72811-047f-45bb-a218-01a2173fc2eb.png',
        furniture: 'https://images.unsplash.com/photo-1600518464441-9154a4dea21b?q=80&w=800',
        track: 'https://z-cdn-media.chatglm.cn/files/b848b1a4-672d-4af8-9061-d08b344fd863.png'
    },
    takeaways: {
        franchises: [
            { id: 'kfc', name: 'KFC', logo: '🍗', logoImg: null, menu: [{ id: 'k1', name: 'Family Meal', price: 180, img: null }, { id: 'k2', name: 'Zinger Wings (6)', price: 65, img: null }]},
            { id: 'deb', name: 'Debonairs', logo: '🍕', logoImg: null, menu: [{ id: 'd1', name: 'Large Margherita', price: 120, img: null }, { id: 'd2', name: 'Triple Decker', price: 150, img: null }]}
        ],
        local: [
            { id: 'kasigrill', name: 'Kasi Grill', logo: '🔥', logoImg: null, menu: [{ id: 'kg1', name: 'Kota & Chips', price: 45, img: null }, { id: 'kg2', name: 'Russian & Chips', price: 35, img: null }]}
        ]
    },
    groceries: [
        { id: 'shoprite', name: 'Shoprite', logo: '🛒', logoImg: null, menu: [{ id: 's1', name: 'Milk 2L', price: 35, img: null }, { id: 's2', name: 'Bread', price: 15, img: null }]},
        { id: 'mamaspaza', name: 'Mama Spaza', logo: '🏪', logoImg: null, menu: [{ id: 'ms1', name: 'Cold Drink 2L', price: 20, img: null }]}
    ]
};

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
            await client.query('INSERT INTO app_state (id, data) VALUES (1, $1)', [JSON.stringify(defaultConfig)]);
        }
    } finally {
        client.release();
    }
}

// API: Get all data
app.get('/api/data', async (req, res) => {
    try {
        const configRes = await pool.query('SELECT data FROM app_state WHERE id = 1');
        let config = configRes.rows[0].data;
        
        // Auto-migrate missing fields
        let needsSave = false;
        for(let key in defaultConfig) {
            if(!config.hasOwnProperty(key)) { config[key] = defaultConfig[key]; needsSave = true; }
        }
        if(needsSave) await pool.query('UPDATE app_state SET data = $1 WHERE id = 1', [JSON.stringify(config)]);

        const ordersRes = await pool.query('SELECT ref, type, details, total, date, status FROM orders ORDER BY date DESC');
        const parcelsRes = await pool.query('SELECT ref, type, details, date, status FROM parcel_requests ORDER BY date DESC');
        const furnitureRes = await pool.query('SELECT ref, vehicle, details, date, status FROM furniture_requests ORDER BY date DESC');

        res.json({
            ...config,
            orders: ordersRes.rows.map(r => ({ ...r, total: parseFloat(r.total) })),
            parcelRequests: parcelsRes.rows,
            furnitureRequests: furnitureRes.rows.map(r => ({ ref: r.ref, ...r.details, date: r.date, status: r.status }))
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

// API: Save configuration
app.post('/api/config', async (req, res) => {
    try {
        await pool.query('UPDATE app_state SET data = $1 WHERE id = 1', [JSON.stringify(req.body)]);
        res.status(200).json({ message: 'Config saved successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to save config' });
    }
});

// API: Save Order
app.post('/api/order', async (req, res) => {
    const { ref, type, details, total, date, status } = req.body;
    try {
        await pool.query('INSERT INTO orders (ref, type, details, total, date, status) VALUES ($1, $2, $3, $4, $5, $6)', 
            [ref, type, JSON.stringify(details), total, date, status]);
        res.status(200).json({ message: 'Order saved' });
    } catch (err) { res.status(500).json({ error: 'Failed to save order' }); }
});

// API: Save Parcel Request
app.post('/api/parcel', async (req, res) => {
    const { ref, type, details, date, status } = req.body;
    try {
        await pool.query('INSERT INTO parcel_requests (ref, type, details, date, status) VALUES ($1, $2, $3, $4, $5)', 
            [ref, type, JSON.stringify(details), date, status]);
        res.status(200).json({ message: 'Parcel saved' });
    } catch (err) { res.status(500).json({ error: 'Failed to save parcel' }); }
});

// API: Save Furniture Request
app.post('/api/furniture', async (req, res) => {
    const { ref, vehicle, details, date, status } = req.body;
    try {
        await pool.query('INSERT INTO furniture_requests (ref, vehicle, details, date, status) VALUES ($1, $2, $3, $4, $5)', 
            [ref, vehicle, JSON.stringify(details), date, status]);
        res.status(200).json({ message: 'Furniture saved' });
    } catch (err) { res.status(500).json({ error: 'Failed to save furniture' }); }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDB().then(() => {
    app.listen(PORT, () => {
        console.log(`KasiDeliveries Server running on port ${PORT} with PostgreSQL and File Uploads`);
    });
}).catch(err => {
    console.error('Database initialization failed', err);
    process.exit(1);
});
