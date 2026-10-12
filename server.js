const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON and URL-encoded data (for large images)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Serve static files from the "public" folder
app.use(express.static(path.join(__dirname, 'public')));

// --- PERMANENT DATABASE STORAGE ---
// If running on Railway, it uses the permanent Volume (/data). If running locally, it uses your project folder.
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const DB_FILE = path.join(DATA_DIR, 'database.json');

// Default Database Structure
const defaultData = {
    users: [{ username: 'admin', password: 'admin123' }],
    siteContent: {
        about: "KasiDeliveries is your trusted local delivery partner. We connect you with your favourite food, groceries, and transport services.",
        contact: "WhatsApp: 0712345678\nEmail: support@kasideliveries.co.za",
        terms: "By using KasiDeliveries, you agree to our terms of service. Prices are estimates and confirmed on WhatsApp.",
        privacy: "We respect your privacy. Your personal details are only used for delivery purposes and are never shared with third parties."
    },
    categories: {
        takeaways: 'https://images.unsplash.com/photo-1561758033-d89a9ad46330?q=80&w=800',
        groceries: 'https://images.unsplash.com/photo-1542838132-92c53300491e?q=80&w=800',
        parcels: 'https://z-cdn-media.chatglm.cn/files/3ae72811-047f-45bb-a218-01a2173fc2eb.png',
        furniture: 'https://images.unsplash.com/photo-1600518464441-9154a4dea21b?q=80&w=800',
        track: 'https://z-cdn-media.chatglm.cn/files/b848b1a4-672d-4af8-9061-d08b344fd863.png'
    },
    takeaways: {
        franchises: [
            { id: 'kfc', name: 'KFC', logo: '🍗', menu: [{ id: 'k1', name: 'Family Meal', price: 180 }, { id: 'k2', name: 'Zinger Wings (6)', price: 65 }]},
            { id: 'deb', name: 'Debonairs', logo: '🍕', menu: [{ id: 'd1', name: 'Large Margherita', price: 120 }, { id: 'd2', name: 'Triple Decker', price: 150 }]}
        ],
        local: [
            { id: 'kasigrill', name: 'Kasi Grill', logo: '🔥', menu: [{ id: 'kg1', name: 'Kota & Chips', price: 45 }, { id: 'kg2', name: 'Russian & Chips', price: 35 }]}
        ]
    },
    groceries: [
        { id: 'shoprite', name: 'Shoprite', logo: '🛒', menu: [{ id: 's1', name: 'Milk 2L', price: 35 }, { id: 's2', name: 'Bread', price: 15 }]},
        { id: 'mamaspaza', name: 'Mama Spaza', logo: '🏪', menu: [{ id: 'ms1', name: 'Cold Drink 2L', price: 20 }]}
    ],
    orders: [],
    parcelRequests: [],
    furnitureRequests: []
};

// Initialize DB file if it doesn't exist
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2));
}

// API: Get all data (Auto-migrates old database files)
app.get('/api/data', (req, res) => {
    let data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    let needsSave = false;
    
    // Automatically add missing fields to old databases
    for(let key in defaultData) {
        if(!data.hasOwnProperty(key)) {
            data[key] = defaultData[key];
            needsSave = true;
        }
    }
    
    if(needsSave) {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    }
    
    res.json(data);
});

// API: Save all data
app.post('/api/data', (req, res) => {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(req.body, null, 2));
        res.status(200).json({ message: 'Data saved successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save data' });
    }
});

// Catch-all route to serve index.html for frontend routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`KasiDeliveries Server running on port ${PORT}`);
});
