import { NextResponse } from 'next/server';
import { db } from '@/db';
import { expenses, schedules } from '@/db/schema';
import { desc } from 'drizzle-orm';
import { getKolkataToday } from '@/lib/date';

function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET() {
  try {
    const allExpenses = await db
      .select()
      .from(expenses)
      .orderBy(desc(expenses.spentOn), desc(expenses.createdAt));

    const allSchedules = await db
      .select()
      .from(schedules)
      .orderBy(schedules.name);

    const lines: string[] = [];

    // Section 1: Expenses
    lines.push('# EXPENSES');
    lines.push(
      'id,spent_on,amount_inr,amount_paise,category,merchant,note,kind,source,one_off,created_at'
    );
    for (const e of allExpenses) {
      const amountInr = (e.amountPaise / 100).toFixed(2);
      lines.push(
        [
          escapeCsv(e.id),
          escapeCsv(e.spentOn),
          escapeCsv(amountInr),
          escapeCsv(e.amountPaise),
          escapeCsv(e.category),
          escapeCsv(e.merchant || ''),
          escapeCsv(e.note || ''),
          escapeCsv(e.kind),
          escapeCsv(e.source),
          escapeCsv(e.oneOff),
          escapeCsv(e.createdAt?.toISOString() || ''),
        ].join(',')
      );
    }

    lines.push('');
    // Section 2: Schedules
    lines.push('# SCHEDULES');
    lines.push(
      'id,name,kind,category,amount_inr,amount_paise,frequency,anchor_date,start_date,end_date,active,last_posted_through,created_at'
    );
    for (const s of allSchedules) {
      const amountInr = (s.amountPaise / 100).toFixed(2);
      lines.push(
        [
          escapeCsv(s.id),
          escapeCsv(s.name),
          escapeCsv(s.kind),
          escapeCsv(s.category),
          escapeCsv(amountInr),
          escapeCsv(s.amountPaise),
          escapeCsv(s.frequency),
          escapeCsv(s.anchorDate),
          escapeCsv(s.startDate),
          escapeCsv(s.endDate || ''),
          escapeCsv(s.active),
          escapeCsv(s.lastPostedThrough || ''),
          escapeCsv(s.createdAt?.toISOString() || ''),
        ].join(',')
      );
    }

    const csvContent = lines.join('\n');
    const today = getKolkataToday();

    return new Response(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="spendcoach_export_${today}.csv"`,
      },
    });
  } catch (error) {
    console.error('Error generating CSV export:', error);
    return NextResponse.json(
      { error: 'Internal server error while exporting data' },
      { status: 500 }
    );
  }
}
