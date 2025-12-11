import express from 'express';
import OpenAI from 'openai';
import cors from 'cors';
import fs from 'fs';
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

// JSON file storage
const DB_PATH = join(__dirname, 'database.json');

// Initialize database
let db = {
  conversations: [],
  messages: []
};

// Load database from file
function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = fs.readFileSync(DB_PATH, 'utf8');
      db = JSON.parse(data);
      console.log('✓ Database loaded');
    } else {
      saveDB();
      console.log('✓ New database created');
    }
  } catch (error) {
    console.error('Error loading database:', error);
    db = { conversations: [], messages: [] };
    saveDB();
  }
}

// Save database to file
function saveDB() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  } catch (error) {
    console.error('Error saving database:', error);
  }
}

// Initialize
loadDB();

// Generate ID
function generateId(array) {
  return array.length > 0 ? Math.max(...array.map(item => item.id)) + 1 : 1;
}

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
    let conversation = db.conversations.find(c => c.id === convId);
    
    if (!conversation) {
      convId = generateId(db.conversations);
      conversation = {
        id: convId,
        user_id: userId || 'anonymous',
        created_at: new Date().toISOString()
      };
      db.conversations.push(conversation);
    }

    // Save user message
    const userMsg = {
      id: generateId(db.messages),
      conversation_id: convId,
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    };
    db.messages.push(userMsg);

    // Get conversation history
    const history = db.messages
      .filter(m => m.conversation_id === convId)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .map(m => ({
        role: m.role,
        content: m.content
      }));

    // Call OpenAI API
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: history
    });

    const aiReply = completion.choices[0].message.content;

    // Save AI response
    const aiMsg = {
      id: generateId(db.messages),
      conversation_id: convId,
      role: 'assistant',
      content: aiReply,
      timestamp: new Date().toISOString()
    };
    db.messages.push(aiMsg);

    // Save to disk
    saveDB();

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
    const conversationId = parseInt(req.params.conversationId);

    const messages = db.messages
      .filter(m => m.conversation_id === conversationId)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

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

    const userConversations = db.conversations
      .filter(c => c.user_id === userId)
      .map(conv => {
        const convMessages = db.messages.filter(m => m.conversation_id === conv.id);
        const lastMessage = convMessages.length > 0 
          ? convMessages[convMessages.length - 1].timestamp 
          : conv.created_at;
        
        return {
          id: conv.id,
          created_at: conv.created_at,
          message_count: convMessages.length,
          last_message: lastMessage
        };
      })
      .sort((a, b) => new Date(b.last_message) - new Date(a.last_message));

    res.json({
      success: true,
      conversations: userConversations
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
    const id = parseInt(req.params.id);

    const convIndex = db.conversations.findIndex(c => c.id === id);
    if (convIndex === -1) {
      return res.status(404).json({ 
        error: 'Conversation not found' 
      });
    }

    // Remove conversation and its messages
    db.conversations.splice(convIndex, 1);
    db.messages = db.messages.filter(m => m.conversation_id !== id);
    
    saveDB();

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
    openai: !!process.env.OPENAI_API_KEY,
    stats: {
      conversations: db.conversations.length,
      messages: db.messages.length
    }
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'OpenAI Chatbot API',
    version: '1.0.0',
    status: 'running',
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
  console.log(`💾 Database: ${db.conversations.length} conversations, ${db.messages.length} messages`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, saving database...');
  saveDB();
  process.exit(0);
});

export default app;
