import { prisma } from '../utils/prisma';
import { getSessionUser } from '../utils/session';
import { startOfWeek, endOfWeek } from 'date-fns';
import { weekNumberFor } from '../utils/dates';
import { getNextSession } from '../utils/plan-service';

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event);
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });

  const [activeMesocycle, weightRows, thisWeekCount, recentWorkouts] = await Promise.all([
    prisma.mesocycle.findFirst({ where: { user_id: userId, status: 'active' }, orderBy: { start_date: 'desc' } }),
    prisma.bodyMetric.findMany({
      where: { user_id: userId, weight: { not: null } },
      orderBy: { date: 'desc' },
      take: 2,
      select: { weight: true, date: true }
    }),
    prisma.workout.count({ where: { user_id: userId, date: { gte: weekStart, lte: weekEnd } } }),
    prisma.workout.findMany({ where: { user_id: userId }, take: 5, orderBy: { date: 'desc' } })
  ]);

  const latestMetric = weightRows[0] ?? null;
  const previousMetric = weightRows[1] ?? null;

  const currentWeek = activeMesocycle ? weekNumberFor(activeMesocycle.start_date, now) : 0;

  const weightDiff = latestMetric?.weight != null && previousMetric?.weight != null
    ? Number((latestMetric.weight - previousMetric.weight).toFixed(2))
    : null;

  let mesocycleWeeklyVolume: { week: number; volume: number; workoutCount: number; avgRpe: number | null }[] = [];
  let daysRemaining: number | null = null;
  let nextSession: Awaited<ReturnType<typeof getNextSession>> = { has_plan: false };

  if (activeMesocycle) {
    const [mesoWorkouts, next] = await Promise.all([
      prisma.workout.findMany({
        where: { user_id: userId, mesocycle_id: activeMesocycle.id },
        select: { date: true, total_volume: true, rpe_avg: true }
      }),
      getNextSession(userId, activeMesocycle.id)
    ]);
    nextSession = next;

    const weekMap = new Map<number, { volume: number; count: number; rpes: number[] }>();
    for (const w of mesoWorkouts) {
      const week = weekNumberFor(activeMesocycle.start_date, w.date);
      if (!weekMap.has(week)) weekMap.set(week, { volume: 0, count: 0, rpes: [] });
      const entry = weekMap.get(week)!;
      entry.volume += w.total_volume ?? 0;
      entry.count++;
      if (w.rpe_avg) entry.rpes.push(w.rpe_avg);
    }

    const lastWeek = Math.max(currentWeek, ...weekMap.keys(), 1);
    const firstWeek = lastWeek <= 16 ? 1 : Math.max(1, currentWeek - 8);
    for (let week = firstWeek; week <= lastWeek; week++) {
      const d = weekMap.get(week) ?? { volume: 0, count: 0, rpes: [] };
      mesocycleWeeklyVolume.push({
        week,
        volume: Math.round(d.volume),
        workoutCount: d.count,
        avgRpe: d.rpes.length ? Math.round(d.rpes.reduce((a, b) => a + b) / d.rpes.length * 10) / 10 : null
      });
    }

    if (activeMesocycle.end_date) {
      daysRemaining = Math.max(0, Math.ceil((new Date(activeMesocycle.end_date).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
    }
  }

  const formattedWorkouts = recentWorkouts.map(w => {
    let exercisesCount = 0;
    try { exercisesCount = JSON.parse(w.exercises_summary || '[]').length; } catch {}
    return {
      id: w.id,
      name: w.name,
      date: w.date,
      duration: w.duration || 0,
      total_volume: Math.round(w.total_volume || 0),
      exercises_count: exercisesCount
    };
  });

  return {
    activeMesocycle: activeMesocycle
      ? { id: activeMesocycle.id, name: activeMesocycle.name, goal: activeMesocycle.goal }
      : null,
    currentWeek,
    daysRemaining,
    mesocycleWeeklyVolume,
    nextSession,
    weight: {
      current: latestMetric?.weight ?? null,
      diff: weightDiff,
      lastUpdated: latestMetric?.date ?? null
    },
    thisWeekWorkouts: {
      completed: thisWeekCount,
      target: activeMesocycle?.target_sessions_weekly ?? null
    },
    recentWorkouts: formattedWorkouts
  };
});
