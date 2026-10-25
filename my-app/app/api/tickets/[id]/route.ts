import { NextRequest, NextResponse } from 'next/server';
import { getTicketAuditLog, getTicketById } from '@/lib/tickets/repository';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { success: false, error: 'Invalid ticket id' },
      { status: 400 },
    );
  }

  try {
    const ticket = await getTicketById(id);
    if (!ticket) {
      return NextResponse.json(
        { success: false, error: 'Ticket not found' },
        { status: 404 },
      );
    }
    const auditLog = await getTicketAuditLog(id);
    return NextResponse.json({ success: true, data: { ticket, auditLog } });
  } catch (error) {
    console.error(`[api/tickets/${id}] fetch failed:`, error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch ticket' },
      { status: 500 },
    );
  }
}
