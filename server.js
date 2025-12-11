import express from 'express';
import OpenAI from 'openai';
import Database from 'better-sqlite3';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize OpenAI
const client = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY 
});

// Middleware
app.use(cors());
app.use(express.json());

// Initialize SQLite database
const db = new Database(join(__dirname, 'messages.db'));

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
  );
`);

console.log('Database initialized');

// POST /message - Send message and get AI response
app.post('/message', async (req, res) => {
  try {
    const { message, conversationId, userId } = req.body;

    if (!message) {
      return res.status(400).json({ 
        error: 'Message is required' 
      });
    }

    // Get or create conversation
    let convId = conversationId;
    if (!convId) {
      const result = db.prepare(
        'INSERT INTO conversations (user_id) VALUES (?)'
      ).run(userId || 'anonymous');
      convId = result.lastInsertRowid;
    }

    // Save user message
    db.prepare(
      'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)'
    ).run(convId, 'user', message);

    // Get conversation history
    const history = db.prepare(
      'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC'
    ).all(convId);

    // Call OpenAI API
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: history.map(msg => ({
        role: msg.role,
        content: msg.content
      }))
    });

    const aiReply = completion.choices[0].message.content;

    // Save AI response
    db.prepare(
      'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)'
    ).run(convId, 'assistant', aiReply);

    res.json({
      success: true,
      conversationId: convId,
      reply: aiReply,
      usage: completion.usage
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      error: 'Failed to process message',
      details: error.message 
    });
  }
});

// GET /history/:conversationId - Get conversation history
app.get('/history/:conversationId', (req, res) => {
  try {
    const { conversationId } = req.params;

    const messages = db.prepare(
      'SELECT id, role, content, timestamp FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC'
    ).all(conversationId);

    if (messages.length === 0) {
      return res.status(404).json({ 
        error: 'Conversation not found' 
      });
    }

    res.json({
      success: true,
      conversationId,
      messages
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve history' 
    });
  }
});

// GET /conversations - Get all conversations
app.get('/conversations', (req, res) => {
  try {
    const userId = req.query.userId || 'anonymous';

    const conversations = db.prepare(`
      SELECT 
        c.id,
        c.created_at,
        COUNT(m.id) as message_count,
        MAX(m.timestamp) as last_message
      FROM conversations c
      LEFT JOIN messages m ON c.id = m.conversation_id
      WHERE c.user_id = ?
      GROUP BY c.id
      ORDER BY last_message DESC
    `).all(userId);

    res.json({
      success: true,
      conversations
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve conversations' 
    });
  }
});

// DELETE /conversation/:id - Delete a conversation
app.delete('/conversation/:id', (req, res) => {
  try {
    const { id } = req.params;

    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id);
    const result = db.prepare('DELETE FROM conversations WHERE id = ?').run(id);

    if (result.changes === 0) {
      return res.status(404).json({ 
        error: 'Conversation not found' 
      });
    }

    res.json({
      success: true,
      message: 'Conversation deleted'
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      error: 'Failed to delete conversation' 
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    openai: !!process.env.OPENAI_API_KEY
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'OpenAI Chatbot API',
    version: '1.0.0',
    endpoints: {
      'POST /message': 'Send a message and get AI response',
      'GET /history/:conversationId': 'Get conversation history',
      'GET /conversations': 'List all conversations',
      'DELETE /conversation/:id': 'Delete a conversation',
      'GET /health': 'Health check'
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 OpenAI API Key: ${process.env.OPENAI_API_KEY ? '✓ Configured' : '✗ Missing'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing database...');
  db.close();
  process.exit(0);
});

export default app;