const TrackingEvent = require('../models/TrackingEvent');
const LeadProfile = require('../models/LeadProfile');

function sourceOf(event) {
  const p = event.properties || {};
  const raw = String(p.utm_source || p.source || p.referrer || '').toLowerCase();
  if (!raw || raw === 'direct' || raw === '(direct)') return 'Directo';
  if (raw.includes('google')) return 'Google';
  if (raw.includes('facebook') || raw.includes('fb.')) return 'Facebook';
  if (raw.includes('instagram')) return 'Instagram';
  if (raw.includes('whatsapp')) return 'WhatsApp';
  if (raw.includes('tiktok')) return 'TikTok';
  if (raw.includes('youtube')) return 'YouTube';
  try {
    const host = new URL(raw).hostname.replace(/^www\./, '');
    return host || 'Otro';
  } catch {
    return raw.length > 30 ? raw.slice(0, 30) : raw || 'Otro';
  }
}

exports.getAdminFunnel = async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 180);
    const since = new Date(Date.now() - days * 86400000);

    const events = await TrackingEvent.find({ createdAt: { $gte: since } })
      .select('anonymous_id user_id session_id event_name properties url user_agent createdAt')
      .sort({ createdAt: -1 })
      .lean();

    const profiles = await LeadProfile.find({ last_seen: { $gte: since } })
      .select('anonymous_id user_id lead_score first_seen last_seen total_sessions total_time_spent')
      .sort({ last_seen: -1 })
      .limit(500)
      .lean();

    const uniqueVisitors = new Set(events.map(e => e.anonymous_id).filter(Boolean));
    const uniqueSessions = new Set(events.map(e => e.session_id).filter(Boolean));
    const registered = new Set(events.map(e => e.user_id).filter(Boolean));

    const byEvent = {};
    const bySource = {};
    const byLanding = {};
    const byDay = {};
    const byDevice = { app: 0, mobileWeb: 0, desktop: 0 };

    for (const e of events) {
      byEvent[e.event_name] = (byEvent[e.event_name] || 0) + 1;

      if (e.event_name === 'page_enter') {
        const source = sourceOf(e);
        bySource[source] = (bySource[source] || 0) + 1;

        let landing = '/';
        try { landing = new URL(e.url || 'https://x/').pathname || '/'; } catch {}
        byLanding[landing] = (byLanding[landing] || 0) + 1;

        const ua = String(e.user_agent || '');
        if (/RosarioMarketAndroid/i.test(ua)) byDevice.app++;
        else if (/Android|iPhone|Mobile/i.test(ua)) byDevice.mobileWeb++;
        else byDevice.desktop++;
      }

      const day = new Date(e.createdAt).toISOString().slice(0,10);
      if (!byDay[day]) byDay[day] = { date: day, visits: 0, downloads: 0, conversions: 0 };
      if (e.event_name === 'page_enter') byDay[day].visits++;
      if (e.event_name === 'apk_download' || e.event_name === 'apk_update') byDay[day].downloads++;
      if (e.event_name === 'lead_conversion' || e.event_name === 'register_success') byDay[day].conversions++;
    }

    const funnel = {
      visitors: uniqueVisitors.size,
      sessions: uniqueSessions.size,
      productViews: byEvent.product_view || 0,
      whatsappClicks: byEvent.whatsapp_click || 0,
      apkDownloads: byEvent.apk_download || 0,
      apkUpdates: byEvent.apk_update || 0,
      registrations: byEvent.register_success || 0,
      conversions: (byEvent.lead_conversion || 0) + (byEvent.register_success || 0),
      identifiedUsers: registered.size,
    };

    const pct = (a, b) => b > 0 ? Math.round((a / b) * 1000) / 10 : 0;

    res.json({
      rangeDays: days,
      funnel: {
        ...funnel,
        visitToProduct: pct(funnel.productViews, funnel.visitors),
        visitToWhatsapp: pct(funnel.whatsappClicks, funnel.visitors),
        visitToDownload: pct(funnel.apkDownloads, funnel.visitors),
        visitToConversion: pct(funnel.conversions, funnel.visitors),
      },
      sources: Object.entries(bySource).map(([name,count]) => ({ name, count })).sort((a,b)=>b.count-a.count).slice(0,12),
      landings: Object.entries(byLanding).map(([path,count]) => ({ path, count })).sort((a,b)=>b.count-a.count).slice(0,12),
      devices: byDevice,
      timeline: Object.values(byDay).sort((a,b)=>a.date.localeCompare(b.date)),
      recentLeads: profiles.slice(0,50).map(p => ({
        id: String(p._id),
        anonymousId: p.anonymous_id,
        userId: p.user_id || null,
        score: p.lead_score || 0,
        firstSeen: p.first_seen,
        lastSeen: p.last_seen,
        sessions: p.total_sessions || 1,
        seconds: p.total_time_spent || 0,
      })),
    });
  } catch (error) {
    console.error('getAdminFunnel:', error);
    res.status(500).json({ message: 'Error obteniendo el embudo de adquisición' });
  }
};

// DELETE /api/admin/funnel?mode=range&days=30
// DELETE /api/admin/funnel?mode=all
// Solo limpia colecciones de tracking/leads. No toca usuarios, negocios, productos ni pedidos.
exports.clearAdminFunnel = async (req, res) => {
  try {
    const mode = req.query.mode === 'all' ? 'all' : 'range';

    let eventFilter = {};
    let profileFilter = {};
    let days = null;

    if (mode === 'range') {
      days = Math.min(Math.max(Number(req.query.days) || 30, 1), 180);
      const since = new Date(Date.now() - days * 86400000);
      eventFilter = { createdAt: { $gte: since } };
      profileFilter = { last_seen: { $gte: since } };
    }

    const [eventsResult, profilesResult] = await Promise.all([
      TrackingEvent.deleteMany(eventFilter),
      LeadProfile.deleteMany(profileFilter),
    ]);

    return res.json({
      ok: true,
      mode,
      days,
      deleted: {
        trackingEvents: eventsResult.deletedCount || 0,
        leadProfiles: profilesResult.deletedCount || 0,
      },
      message: mode === 'all'
        ? 'Se limpiaron todos los datos de Leads y tracking.'
        : `Se limpiaron los datos de Leads y tracking de los últimos ${days} días.`,
    });
  } catch (error) {
    console.error('clearAdminFunnel:', error);
    return res.status(500).json({ message: 'Error limpiando los datos de Leads' });
  }
};
