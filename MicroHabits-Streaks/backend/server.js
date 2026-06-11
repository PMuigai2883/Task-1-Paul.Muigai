const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
});

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

// ==================== AUTH ROUTES ====================

// SIGNUP
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { firstName, lastName, email, password } = req.body;
        
        if (!firstName || !lastName || !email || !password) {
            return res.status(400).json({ error: 'All fields required' });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Insert user
        const result = await pool.query(
            'INSERT INTO users (email, password_hash, first_name, last_name) VALUES ($1, $2, $3, $4) RETURNING id, email',
            [email, hashedPassword, firstName, lastName]
        );
        
        const user = result.rows[0];
        
        // Create JWT token
        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '24h' });
        
        res.json({ 
            message: 'User created successfully',
            userId: user.id,
            token 
        });
    } catch (error) {
        if (error.code === '23505') {
            res.status(400).json({ error: 'Email already exists' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }
        
        // Find user
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }
        
        const user = result.rows[0];
        
        // Compare passwords
        const validPassword = await bcrypt.compare(password, user.password_hash);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid password' });
        }
        
        // Create JWT token
        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '24h' });
        
        res.json({
            message: 'Login successful',
            userId: user.id,
            firstName: user.first_name,
            lastName: user.last_name,
            token
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== COMMITMENTS ROUTES ====================

// GET all commitments for user
app.get('/api/commitments', verifyToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM commitments WHERE user_id = $1 ORDER BY created_at DESC',
            [req.userId]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// CREATE commitment
app.post('/api/commitments', verifyToken, async (req, res) => {
    try {
        const { title, description, targetDate, type } = req.body;
        
        if (!title || !targetDate || !type) {
            return res.status(400).json({ error: 'Title, targetDate, and type required' });
        }
        
        const result = await pool.query(
            'INSERT INTO commitments (user_id, title, description, target_date, type) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [req.userId, title, description, targetDate, type]
        );
        
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// UPDATE commitment
app.put('/api/commitments/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, targetDate, type, completed } = req.body;
        
        const result = await pool.query(
            'UPDATE commitments SET title = $1, description = $2, target_date = $3, type = $4, completed = $5 WHERE id = $6 AND user_id = $7 RETURNING *',
            [title, description, targetDate, type, completed, id, req.userId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Commitment not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE commitment
app.delete('/api/commitments/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(
            'DELETE FROM commitments WHERE id = $1 AND user_id = $2 RETURNING id',
            [id, req.userId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Commitment not found' });
        }
        
        res.json({ message: 'Commitment deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== STEPS ROUTES ====================

// GET steps for a commitment
app.get('/api/commitments/:commitmentId/steps', verifyToken, async (req, res) => {
    try {
        const { commitmentId } = req.params;
        
        const result = await pool.query(
            'SELECT s.* FROM steps s JOIN commitments c ON s.commitment_id = c.id WHERE c.id = $1 AND c.user_id = $2',
            [commitmentId, req.userId]
        );
        
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// CREATE step
app.post('/api/commitments/:commitmentId/steps', verifyToken, async (req, res) => {
    try {
        const { commitmentId } = req.params;
        const { title, dueDate } = req.body;
        
        if (!title) {
            return res.status(400).json({ error: 'Title required' });
        }
        
        const result = await pool.query(
            'INSERT INTO steps (commitment_id, title, due_date) VALUES ($1, $2, $3) RETURNING *',
            [commitmentId, title, dueDate]
        );
        
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// UPDATE step
app.put('/api/steps/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { completed } = req.body;
        
        const result = await pool.query(
            'UPDATE steps SET completed = $1 WHERE id = $2 RETURNING *',
            [completed, id]
        );
        
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE step
app.delete('/api/steps/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        await pool.query('DELETE FROM steps WHERE id = $1', [id]);
        
        res.json({ message: 'Step deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});