export default function PostcodePrompt({ onSave, onDismiss }) {
  return (
    <div style={{ position:'fixed', inset:0, zIndex:999, background:'rgba(0,0,0,.7)', backdropFilter:'blur(6px)', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ background:'var(--card)', border:'1px solid rgba(255,255,255,.12)', borderRadius:20, padding:'32px 28px', maxWidth:340, width:'100%', textAlign:'center' }}>
        <div style={{ fontSize:32, marginBottom:12 }}>📍</div>
        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, letterSpacing:2, marginBottom:10, background:'linear-gradient(135deg,#00E5FF,#BF5FFF)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>
          ADD YOUR LOCATION
        </div>
        <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, color:'rgba(255,255,255,.65)', lineHeight:1.6, marginBottom:24 }}>
          To appear in Discover searches you need either a <strong style={{ color:'#fff' }}>town / suburb</strong> or a <strong style={{ color:'#fff' }}>postcode</strong> on your profile. Without one, you won't show up when people search by location.
        </div>
        <div style={{ display:'flex', gap:10 }}>
          <button
            onClick={onDismiss}
            style={{ flex:1, padding:'12px 0', borderRadius:12, border:'1px solid rgba(255,255,255,.15)', background:'rgba(255,255,255,.06)', color:'rgba(255,255,255,.5)', fontFamily:"'Bebas Neue',sans-serif", fontSize:15, letterSpacing:1, cursor:'pointer' }}
          >SAVE ANYWAY</button>
          <button
            onClick={onSave}
            style={{ flex:1, padding:'12px 0', borderRadius:12, border:'none', background:'linear-gradient(135deg,#00E5FF,#BF5FFF)', color:'#0a0a0f', fontFamily:"'Bebas Neue',sans-serif", fontSize:15, letterSpacing:1, cursor:'pointer', fontWeight:700 }}
          >ADD LOCATION</button>
        </div>
      </div>
    </div>
  );
}
