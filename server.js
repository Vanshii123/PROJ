import express from 'express';
import OpenAI from 'openai';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize OpenAI (will use mock if no key)
const client = process.env.OPENAI_API_KEY 
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Middleware
app.use(cors());
app.use(express.json());

// ✅ IN-MEMORY STORAGE - THIS IS CRITICAL
const conversations = {};

// Helper: Get or create conversation
function getConversation(id) {
  if (!conversations[id]) {
    conversations[id] = [];
  }
  return conversations[id];
}

// ✅ POST /message - STORES MESSAGES + GENERATES REPLY
app.post('/message', async (req, res) => {
  try {
    const { conversationId, message } = req.body;

    // Validate
    if (!conversationId) {
      return res.status(400).json({ 
        success: false,
        error: 'conversationId is required' 
      });
    }
    if (!message) {
      return res.status(400).json({ 
        success: false,
        error: 'message is required' 
      });
    }

    console.log(`[${conversationId}] Received: ${message}`);

    // Get conversation history
    const conv = getConversation(conversationId);

    // ✅ STEP 1: Store user message
    const userMsg = {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    };
    conv.push(userMsg);

    // ✅ STEP 2: Generate AI reply
    let aiReply;
    
    if (client) {
      // Real OpenAI call
      try {
        const completion = await client.chat.completions.create({
          model: "gpt-4o-mini",
          messages: conv.map(m => ({ role: m.role, content: m.content }))
        });
        aiReply = completion.choices[0].message.content;
      } catch (error) {
        console.error('OpenAI error:', error);
        aiReply = `Error calling OpenAI: ${error.message}`;
      }
    } else {
      // Mock reply (no API key)
      aiReply = `Echo: ${message} (Mock reply - set OPENAI_API_KEY for real AI)`;
    }

    // ✅ STEP 3: Store AI reply
    const aiMsg = {
      role: 'assistant',
      content: aiReply,
      timestamp: new Date().toISOString()
    };
    conv.push(aiMsg);

    console.log(`[${conversationId}] Replied. Total messages: ${conv.length}`);

    // ✅ STEP 4: Return response
    res.json({
      success: true,
      conversationId: conversationId,
      reply: aiReply,
      messageCount: conv.length
    });

  } catch (error) {
    console.error('Error in POST /message:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to process message',
      details: error.message 
    });
  }
});

// ✅ GET /history/:conversationId - RETURNS STORED MESSAGES
app.get('/history/:conversationId', (req, res) => {
  try {
    const { conversationId } = req.params;
    const conv = getConversation(conversationId);

    console.log(`[${conversationId}] History requested. Messages: ${conv.length}`);

    res.json({
      success: true,
      conversationId: conversationId,
      messages: conv,
      count: conv.length
    });

  } catch (error) {
    console.error('Error in GET /history:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to retrieve history' 
    });
  }
});

// GET /conversations - List all
app.get('/conversations', (req, res) => {
  try {
    const list = Object.keys(conversations).map(id => ({
      conversationId: id,
      messageCount: conversations[id].length,
      lastMessage: conversations[id][conversations[id].length - 1]?.timestamp
    }));

    res.json({
      success: true,
      conversations: list,
      total: list.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /conversation/:id
app.delete('/conversation/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (conversations[id]) {
      delete conversations[id];
      console.log(`[${id}] Deleted`);
    }
    res.json({ success: true, message: 'Conversation deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  const totalMessages = Object.values(conversations)
    .reduce((sum, conv) => sum + conv.length, 0);

  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    openai: !!process.env.OPENAI_API_KEY,
    storage: {
      conversations: Object.keys(conversations).length,
      totalMessages: totalMessages
    }
  });
});

// Root
app.get('/', (req, res) => {
  res.json({
    name: 'OpenAI Chatbot API',
    version: '2.0.0',
    endpoints: {
      'POST /message': 'Send a message and get AI response',
      'GET /history/:conversationId': 'Get conversation history',
      'GET /conversations': 'List all conversations',
      'DELETE /conversation/:id': 'Delete a conversation',
      'GET /health': 'Health check'
    }
  });
});

// Start
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 OpenAI: ${process.env.OPENAI_API_KEY ? '✅ Active' : '❌ Mock mode'}`);
  console.log(`💾 Storage: In-memory (resets on restart)`);
});

export default app;
