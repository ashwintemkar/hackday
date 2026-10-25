// api/stream/route.ts
import { NextRequest } from 'next/server';
import { queryChatAndAnswer } from '@/lib/pgvector/query';

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  const customReadable = new ReadableStream({
    async start(controller) {
      try {
        const { query, chatId } = await req.json();

        const streamResponse = async function* () {
          try {
            const { response, sourceInfo } = await queryChatAndAnswer({ query, chatId });

            if (!response) {
              throw new Error('No response received from query');
            }

            yield JSON.stringify({ type: 'source-info', data: sourceInfo }) + '\n';
            
            const words = response.split(' ');
            for (const word of words) {
              yield word + ' ';
              await new Promise(resolve => setTimeout(resolve, 50));
            }
          } catch (error) {
            console.error('Error in stream generation:', error);
            yield 'An error occurred while processing your request. ';
          }
        };

        for await (const chunk of streamResponse()) {
          controller.enqueue(encoder.encode(chunk));
        }

        controller.close();
      } catch (error) {
        console.error('Streaming error:', error);
        controller.enqueue(encoder.encode('An error occurred while processing your request. '));
        controller.close();
      }
    },
  });

  return new Response(customReadable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}