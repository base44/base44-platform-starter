import { NextResponse } from 'next/server';

const apps = [
  { id: 'app-1', name: 'Team retro board', user_description: 'Collect and group retro notes.' },
  { id: 'app-2', name: 'Sprint capacity planner', user_description: 'Plan load per sprint.' },
  { id: 'app-3', name: 'Client onboarding tracker', user_description: 'Track onboarding steps.' },
];

export async function POST(request: Request) {
  const { action, appId } = await request.json();
  if (action === 'listApps') return NextResponse.json({ apps, hasMore: false, nextSkip: 0 });
  if (action === 'getApp') return NextResponse.json(apps.find((a) => a.id === appId) ?? apps[0]);
  if (action === 'getConversation')
    return NextResponse.json({
      messages: [
        { id: 'm1', role: 'user', content: 'Add a column for blockers.' },
        { id: 'm2', role: 'assistant', content: 'Added a Blockers column to the board.' },
      ],
    });
  if (action === 'getPublishedUrl') return NextResponse.json({ url: null });
  return NextResponse.json({});
}
