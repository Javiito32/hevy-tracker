import { prisma } from '../utils/prisma';
import { getSessionUser } from '../utils/session';
import { startOfWeek, endOfWeek } from 'date-fns';

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event);
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });

  const [activeMesocycle, latestMetric, previousMetric, thisWeekCount, recentWorkouts] = await Promise.all([
    prisma.mesocycle.findFirst({ where: { user_id: userId, status: 'active' }, orderBy: { start_date: 'desc' } }),
    prisma.bodyMetric.findFirst({ where: { user_id: userId }, orderBy: { date: 'desc' } }),
    prisma.bodyMetric.findFirst({ where: { user_id: userId, date: { lt: now } }, orderBy: { date: 'desc' }, skip: 1 }),
    prisma.workout.count({ where: { user_id: userId, date: { gte: weekStart, lte: weekEnd } } }),
    prisma.workout.findMany({ where: { user_id: userId }, take: 5, orderBy: { date: 'desc' } })
  ]);

  const currentWeek = activeMesocycle
    ? Math.max(1, Math.ceil((now.getTime() - new Date(activeMesocycle.start_date).getTime()) / (7 * 24 * 60 * 60 * 1000)))
    : 0;

  const weightDiff = latestMetric?.weight && previousMetric?.weight
    ? Number((latestMetric.weight - previousMetric.weight).toFixed(2))
    : 0;

  let mesocycleWeeklyVolume: { week: number; volume: number; workoutCount: number; avgRpe: number | null }[] = [];
  let daysRemaining: number | null = null;

  if (activeMesocycle) {
    const mesoWorkouts = await prisma.workout.findMany({
      where: { user_id: userId, mesocycle_id: activeMesocycle.id },
      select: { date: true, total_volume: true, rpe_avg: true }
    });

    const weekMap = new Map<number, { volume: number; count: number; rpes: number[] }>();
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    for (const w of mesoWorkouts) {
      const week = Math.max(1, Math.ceil((new Date(w.date).getTime() - new Date(activeMesocycle.start_date).getTime()) / msPerWeek));
      if (!weekMap.has(week)) weekMap.set(week, { volume: 0, count: 0, rpes: [] });
      const entry = weekMap.get(week)!;
      entry.volume += w.total_volume ?? 0;
      entry.count++;
      if (w.rpe_avg) entry.rpes.push(w.rpe_avg);
    }

    mesocycleWeeklyVolume = Array.from(weekMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([week, d]) => ({
        week,
        volume: Math.round(d.volume),
        workoutCount: d.count,
        avgRpe: d.rpes.length ? Math.round(d.rpes.reduce((a, b) => a + b) / d.rpes.length * 10) / 10 : null
      }));

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
    weight: {
      current: latestMetric?.weight ?? null,
      diff: weightDiff,
      lastUpdated: latestMetric?.date ?? null
    },
    thisWeekWorkouts: {
      completed: thisWeekCount,
      target: activeMesocycle?.target_volume_weekly ?? 4
    },
    recentWorkouts: formattedWorkouts
  };
});
