import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import { agentService } from '../lib/agent/AgentService';

const router = Router();

router.post('/chat', authMiddleware, async (req: Request, res: Response) => {
    const { messages } = req.body;
    const userId = req.user!.userId;

    if (!messages || !Array.isArray(messages)) {
        res.status(400).json({ error: { message: 'Messages array is required' } });
        return;
    }

    try {
        const stream = await agentService.chatStream(userId, messages);

        // Configurar headers para SSE (Server-Sent Events)
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
            }
        }

        res.write('data: [DONE]\n\n');
        res.end();
    } catch (err: any) {
        console.error('Error in Kinetic AI Chat:', err);
        // Si ya empezamos a escribir en el stream, no podemos mandar un JSON de error
        if (!res.headersSent) {
            res.status(500).json({ error: { message: 'Error in Kinetic AI Chat' } });
        } else {
            res.write(`data: ${JSON.stringify({ error: 'Stream interrupted' })}\n\n`);
            res.end();
        }
    }
});

export default router;
