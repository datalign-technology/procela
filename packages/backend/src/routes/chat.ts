import { Router, Request, Response } from 'express';
import { aiService } from '../services/ai.service';
import { ChatMessage } from '../types';
import logger from '../lib/logger';

const router = Router();

/**
 * POST /api/v1/chat
 * Multi-turn conversational chat with organization-aware context.
 *
 * Body: { messages: [{role, content}...], orgContext?: {orgName, industry} }
 * Returns: { success: true, data: { reply: string } }
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { messages, orgContext } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({
        success: false,
        error: 'messages is required and must be a non-empty array of {role, content} objects.',
      });
      return;
    }

    // Validate each message has role and content
    for (const msg of messages) {
      if (!msg.role || !msg.content || !['user', 'assistant'].includes(msg.role)) {
        res.status(400).json({
          success: false,
          error: 'Each message must have a valid role ("user" or "assistant") and content.',
        });
        return;
      }
    }

    const chatMessages: ChatMessage[] = messages.map((m: ChatMessage) => ({
      role: m.role,
      content: m.content,
    }));

    const context = {
      orgId: orgContext?.orgId ?? '',
      orgName: orgContext?.orgName ?? 'Unknown',
      industry: orgContext?.industry ?? 'General',
    };

    const reply = await aiService.chat(chatMessages, context);

    res.json({ success: true, data: { reply } });
  } catch (err) {
    logger.error({ err }, 'Chat request failed');
    res.status(500).json({
      success: false,
      error: 'Failed to process chat request. Please try again.',
    });
  }
});

export default router;
