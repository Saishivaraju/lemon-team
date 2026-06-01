/**
 * PropEdge Mobile App — Agent Dashboard
 * ─────────────────────────────────────────────────
 * VAPI handles all AI calling automatically.
 * This app shows live status, leads, calls, bookings.
 * No manual dialing needed — VAPI does everything.
 * ─────────────────────────────────────────────────
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  SafeAreaView, StatusBar, ScrollView,
  Alert, RefreshControl, Linking
} from 'react-native';

// ── YOUR VERCEL URL ── UPDATE THIS ──────────────
const BACKEND_URL = 'https://scaleover-lemon.vercel.app';
// ─────────────────────────────────────────────────

export default function App() {
  const [tab, setTab]           = useState('home');
  const [stats, setStats]       = useState({ leads: 0, calls: 0, booked: 0, answered: 0 });
  const [leads, setLeads]       = useState([]);
  const [calls, setCalls]       = useState([]);
  const [bookings, setBookings] = useState([]);
  const [vapiStatus, setVapiStatus]   = useState(null);
  const [waStatus, setWaStatus]       = useState(null);
  const [refreshing, setRefreshing]   = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setRefreshing(true);
    await Promise.all([loadStats(), loadLeads(), loadCalls(), checkStatuses()]);
    setLastUpdated(new Date().toLocaleTimeString());
    setRefreshing(false);
  };

  const loadStats = async () => {
    try {
      const r = await fetch(`${BACKEND_URL}/api/report`);
      const d = await r.json();
      if (d.summary) setStats({
        leads:    d.summary.total_leads    || 0,
        calls:    d.summary.calls_made     || 0,
        answered: d.summary.calls_answered || 0,
        booked:   d.summary.bookings       || 0,
      });
    } catch (e) {}
  };

  const loadLeads = async () => {
    try {
      const r = await fetch(`${BACKEND_URL}/api/call-logs?limit=30`);
      const d = await r.json();
      if (d.logs) setCalls(d.logs);
    } catch (e) {}
  };

  const loadCalls = async () => {
    try {
      const r = await fetch(`${BACKEND_URL}/api/vapi/calls`);
      const d = await r.json();
      if (d.calls) setCalls(d.calls.slice(0, 20));
    } catch (e) {}
  };

  const checkStatuses = async () => {
    try {
      const [vr, wr] = await Promise.all([
        fetch(`${BACKEND_URL}/api/vapi/status`),
        fetch(`${BACKEND_URL}/api/whatsapp/status`),
      ]);
      setVapiStatus(await vr.json());
      setWaStatus(await wr.json());
    } catch (e) {}
  };

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="#07080f" />

      {/* ── TOP BAR ── */}
      <View style={s.topBar}>
        <View>
          <Text style={s.logo}>🏠 PropEdge</Text>
          <Text style={s.lastUpdate}>Updated {lastUpdated || '...'}</Text>
        </View>
        <TouchableOpacity style={s.refreshBtn} onPress={loadAll}>
          <Text style={s.refreshTxt}>{refreshing ? '⏳' : '↻'}</Text>
        </TouchableOpacity>
      </View>

      {/* ── TAB CONTENT ── */}
      <ScrollView
        style={s.page}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadAll} tintColor="#f0c040" />}
      >
        {tab === 'home'  && <HomeTab  stats={stats} vapiStatus={vapiStatus} waStatus={waStatus} BACKEND_URL={BACKEND_URL} />}
        {tab === 'calls' && <CallsTab calls={calls} />}
        {tab === 'books' && <BookingsTab bookings={bookings} />}
      </ScrollView>

      {/* ── BOTTOM TABS ── */}
      <View style={s.tabs}>
        {[
          { key: 'home',  icon: '🏠', label: 'Home'     },
          { key: 'calls', icon: '📞', label: 'Calls'    },
          { key: 'books', icon: '📅', label: 'Bookings' },
        ].map(t => (
          <TouchableOpacity key={t.key} style={[s.tab, tab === t.key && s.tabActive]} onPress={() => setTab(t.key)}>
            <Text style={s.tabIcon}>{t.icon}</Text>
            <Text style={[s.tabTxt, tab === t.key && s.tabTxtActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

// ── HOME TAB ──────────────────────────────────────
function HomeTab({ stats, vapiStatus, waStatus, BACKEND_URL }) {
  return (
    <View style={{ paddingBottom: 20 }}>

      {/* VAPI Status */}
      <View style={[s.statusCard, vapiStatus?.configured ? s.statusGreen : s.statusYellow]}>
        <Text style={s.statusIcon}>{vapiStatus?.configured ? '🤖' : '⚠️'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.statusTitle}>{vapiStatus?.configured ? 'VAPI AI Calling Active' : 'VAPI Not Configured'}</Text>
          <Text style={s.statusSub}>{vapiStatus?.configured ? 'Calls fire automatically when leads arrive' : 'Add VAPI_API_KEY to Vercel env vars'}</Text>
        </View>
      </View>

      {/* WhatsApp Status */}
      <View style={[s.statusCard, waStatus?.ready ? s.statusGreen : s.statusYellow]}>
        <Text style={s.statusIcon}>{waStatus?.ready ? '💬' : '⚠️'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.statusTitle}>{waStatus?.ready ? 'WhatsApp Connected' : 'WhatsApp Not Connected'}</Text>
          <Text style={s.statusSub}>{waStatus?.ready ? 'Follow-ups send from your number' : 'Run whatsapp-bridge/start.sh in Termux'}</Text>
        </View>
      </View>

      {/* Stats Grid */}
      <View style={s.statsGrid}>
        {[
          { label: 'Total Leads', value: stats.leads,    color: '#6c63ff' },
          { label: 'Calls Made',  value: stats.calls,    color: '#3b82f6' },
          { label: 'Answered',    value: stats.answered, color: '#10b981' },
          { label: 'Booked',      value: stats.booked,   color: '#f0c040' },
        ].map(st => (
          <View key={st.label} style={s.statCard}>
            <Text style={[s.statNum, { color: st.color }]}>{st.value}</Text>
            <Text style={s.statLabel}>{st.label}</Text>
          </View>
        ))}
      </View>

      {/* How VAPI works */}
      <View style={s.infoCard}>
        <Text style={s.infoTitle}>⚡ How It Works</Text>
        {[
          '1. Lead fills form on your website',
          '2. VAPI automatically calls them',
          '3. AI (Priya) talks, qualifies, books',
          '4. WhatsApp follow-ups sent automatically',
          '5. You see everything here in real-time',
        ].map(line => <Text key={line} style={s.infoLine}>{line}</Text>)}
      </View>

      {/* Open dashboard link */}
      <TouchableOpacity style={s.dashBtn} onPress={() => Linking.openURL(BACKEND_URL + '/propedge_dashboard.html')}>
        <Text style={s.dashBtnTxt}>🖥  Open Full Dashboard</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── CALLS TAB ─────────────────────────────────────
function CallsTab({ calls }) {
  const STATUS_COLOR = { answered: '#10b981', no_answer: '#f0c040', failed: '#ef4444', 'in-progress': '#6c63ff' };
  return (
    <View style={{ paddingBottom: 20 }}>
      <Text style={s.sectionTitle}>📞 Recent VAPI Calls</Text>
      {calls.length === 0
        ? <View style={s.emptyBox}><Text style={s.emptyIcon}>📭</Text><Text style={s.emptyTxt}>No calls yet. VAPI will call leads automatically.</Text></View>
        : calls.map((call, i) => {
          const status = call.status || call.endedReason || 'unknown';
          const dur = call.duration_sec || call.durationSeconds;
          const phone = call.phone || call.customer?.number || '—';
          const time = call.called_at || call.createdAt;
          return (
            <View key={i} style={s.callRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.callPhone}>{phone}</Text>
                <Text style={s.callTime}>{time ? new Date(time).toLocaleString() : '—'}</Text>
                {dur ? <Text style={s.callDur}>{Math.floor(dur/60)}m {dur%60}s</Text> : null}
              </View>
              <Text style={[s.callStatus, { color: STATUS_COLOR[status] || '#ffffff60' }]}>
                {status === 'answered' ? '✅' : status === 'in-progress' ? '🔄' : '📵'} {status}
              </Text>
            </View>
          );
        })
      }
    </View>
  );
}

// ── BOOKINGS TAB ──────────────────────────────────
function BookingsTab({ bookings }) {
  return (
    <View style={{ paddingBottom: 20 }}>
      <Text style={s.sectionTitle}>📅 AI Booked Visits</Text>
      {bookings.length === 0
        ? <View style={s.emptyBox}><Text style={s.emptyIcon}>📅</Text><Text style={s.emptyTxt}>Bookings will appear here when VAPI books visits.</Text></View>
        : bookings.map((b, i) => (
          <View key={i} style={s.bookCard}>
            <View style={s.bookBadge}><Text style={s.bookBadgeTxt}>✅ AI BOOKED</Text></View>
            <Text style={s.bookProp}>🏠 {b.property}</Text>
            <Text style={s.bookClient}>👤 {b.client} — {b.phone}</Text>
            <Text style={s.bookDate}>📅 {b.date}  🕒 {b.time}</Text>
          </View>
        ))
      }
    </View>
  );
}

// ── STYLES ────────────────────────────────────────
const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: '#07080f' },
  topBar:       { flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingHorizontal:18, paddingVertical:14, borderBottomWidth:1, borderBottomColor:'#ffffff0f' },
  logo:         { color:'#f0c040', fontSize:20, fontWeight:'900' },
  lastUpdate:   { color:'#ffffff30', fontSize:10, marginTop:2 },
  refreshBtn:   { width:36, height:36, borderRadius:18, backgroundColor:'#ffffff10', alignItems:'center', justifyContent:'center' },
  refreshTxt:   { color:'#fff', fontSize:18 },
  page:         { flex:1, paddingHorizontal:16, paddingTop:14 },
  statusCard:   { flexDirection:'row', alignItems:'center', gap:12, padding:14, borderRadius:12, marginBottom:10, borderWidth:1 },
  statusGreen:  { backgroundColor:'#10b98110', borderColor:'#10b98130' },
  statusYellow: { backgroundColor:'#f0c04010', borderColor:'#f0c04030' },
  statusIcon:   { fontSize:24 },
  statusTitle:  { color:'#fff', fontSize:13, fontWeight:'700' },
  statusSub:    { color:'#ffffff50', fontSize:11, marginTop:2 },
  statsGrid:    { flexDirection:'row', flexWrap:'wrap', gap:10, marginBottom:14 },
  statCard:     { width:'47%', backgroundColor:'#12131f', borderRadius:12, padding:16, alignItems:'center', borderWidth:1, borderColor:'#ffffff08' },
  statNum:      { fontSize:28, fontWeight:'900' },
  statLabel:    { color:'#ffffff50', fontSize:11, marginTop:4 },
  infoCard:     { backgroundColor:'#12131f', borderRadius:14, padding:16, marginBottom:14, borderWidth:1, borderColor:'#ffffff08' },
  infoTitle:    { color:'#f0c040', fontSize:13, fontWeight:'800', marginBottom:10 },
  infoLine:     { color:'#ffffff60', fontSize:12, marginBottom:6 },
  dashBtn:      { backgroundColor:'#6c63ff', padding:16, borderRadius:14, alignItems:'center' },
  dashBtnTxt:   { color:'#fff', fontWeight:'900', fontSize:15 },
  sectionTitle: { color:'#ffffff50', fontSize:12, fontWeight:'700', textTransform:'uppercase', letterSpacing:1, marginBottom:12 },
  emptyBox:     { alignItems:'center', paddingVertical:60 },
  emptyIcon:    { fontSize:44, marginBottom:12 },
  emptyTxt:     { color:'#ffffff30', fontSize:13, textAlign:'center' },
  callRow:      { flexDirection:'row', justifyContent:'space-between', alignItems:'center', backgroundColor:'#12131f', borderRadius:12, padding:14, marginBottom:8, borderWidth:1, borderColor:'#ffffff06' },
  callPhone:    { color:'#fff', fontSize:14, fontWeight:'700' },
  callTime:     { color:'#ffffff50', fontSize:11, marginTop:3 },
  callDur:      { color:'#6c63ff', fontSize:11, marginTop:2 },
  callStatus:   { fontSize:12, fontWeight:'600' },
  bookCard:     { backgroundColor:'#12131f', borderRadius:14, padding:16, marginBottom:10, borderWidth:1, borderColor:'#ffffff08' },
  bookBadge:    { backgroundColor:'#10b98120', borderRadius:8, paddingHorizontal:10, paddingVertical:4, alignSelf:'flex-start', marginBottom:10 },
  bookBadgeTxt: { color:'#10b981', fontSize:11, fontWeight:'800' },
  bookProp:     { color:'#fff', fontSize:15, fontWeight:'700', marginBottom:5 },
  bookClient:   { color:'#ffffff70', fontSize:13, marginBottom:5 },
  bookDate:     { color:'#f0c040', fontSize:13, fontWeight:'600' },
  tabs:         { flexDirection:'row', borderTopWidth:1, borderTopColor:'#ffffff0f', backgroundColor:'#07080f' },
  tab:          { flex:1, paddingVertical:12, alignItems:'center' },
  tabActive:    { borderTopWidth:2, borderTopColor:'#f0c040' },
  tabIcon:      { fontSize:20, marginBottom:2 },
  tabTxt:       { color:'#ffffff40', fontSize:11, fontWeight:'600' },
  tabTxtActive: { color:'#f0c040' },
});
