'use strict';
const fs = require('fs');
const path = require('path');

module.exports = function (app) {
  const plugin = {};
  plugin.id = 'signalk-nmea0183-logger';
  plugin.name = 'NMEA0183 Sentence Logger';
  plugin.description = 'Logs NMEA0183 sentences. GPS track on OpenSeaMap with stats, TWA, position-based weather.';

  let unsubscribe = null, currentLogDate = null, currentWriteStream = null;
  let logDir = null, config = {}, sentenceStats = {}, statusInterval = null;

  const SENTENCE_TYPES = {
    GGA:'GPS Fix',GLL:'Geo Position',RMC:'Rec Min Nav',RMB:'Rec Min Nav WPT',
    VTG:'Track/Speed',GSA:'GPS DOP',GSV:'Satellites',ZDA:'Time/Date',GNS:'GNSS Fix',
    HDG:'Heading Dev Var',HDM:'Heading Mag',HDT:'Heading True',
    MWV:'Wind Speed/Angle',MWD:'Wind Dir/Speed',VWR:'Relative Wind',
    DBT:'Depth Transducer',DBS:'Depth Surface',DBK:'Depth Keel',DPT:'Depth',
    VHW:'Water Speed',APB:'Autopilot B',BOD:'Bearing Orig-Dest',
    BWC:'Bearing Dist WPT',BWR:'Bearing Dist Rhumb',RTE:'Routes',WPL:'Waypoint',
    XTE:'Cross Track',XDR:'Transducer',RSA:'Rudder Angle',RPM:'Revolutions',
    MTW:'Water Temp',MTA:'Air Temp',MMB:'Barometer',MDA:'Meteo Composite',
    VDM:'AIS Message',VDO:'AIS Own-Vessel',TXT:'Text',TTM:'Tracked Target',TLL:'Target Lat/Lon'
  };

  function parseLatLon(latS,latD,lonS,lonD) {
    if(!latS||!lonS||!latD||!lonD) return null;
    let lat=parseInt(latS.substring(0,2),10)+parseFloat(latS.substring(2))/60;
    if(latD==='S') lat=-lat;
    let lon=parseInt(lonS.substring(0,3),10)+parseFloat(lonS.substring(3))/60;
    if(lonD==='W') lon=-lon;
    if(isNaN(lat)||isNaN(lon)||(lat===0&&lon===0)||Math.abs(lat)>90||Math.abs(lon)>180) return null;
    return {lat,lon};
  }
  function parseDateTime(t,d) {
    if(!t||t.length<6) return null;
    if(d&&d.length>=6){
      let yy=parseInt(d.substring(4,6),10); yy=yy<80?2000+yy:1900+yy;
      return new Date(Date.UTC(yy,parseInt(d.substring(2,4),10)-1,parseInt(d.substring(0,2),10),
        parseInt(t.substring(0,2),10),parseInt(t.substring(2,4),10),parseInt(t.substring(4,6),10)));
    }
    return null;
  }
  function haversineNm(a,b,c,d) {
    const R=3440.065,dL=(c-a)*Math.PI/180,dO=(d-b)*Math.PI/180;
    const x=Math.sin(dL/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dO/2)**2;
    return 2*R*Math.asin(Math.sqrt(x));
  }
  function strip(f){if(!f)return'';const i=f.indexOf('*');return i>=0?f.substring(0,i):f;}

  function parseLogFile(filepath) {
    const content=fs.readFileSync(filepath,'utf8');
    const lines=content.split('\n').filter(l=>l.trim());
    const track=[],sogV=[],twsV=[],twaV=[],rpmE=[];
    let startTime=null,endTime=null,totalDist=0,prevPos=null;
    // 2-hour interval buckets for weather: key = hourBucket (0,2,4,...22)
    const intervalBuckets = {}; // { bucket: { latSum, lonSum, count } }

    for(const line of lines){
      let s=line.trim(),logTs=null;
      const tm=s.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+(.*)/);
      if(tm){logTs=new Date(tm[1]);s=tm[2];}
      if(s[0]!=='$'&&s[0]!=='!') continue;
      const f=s.split(',');if(f.length<2)continue;
      const st=f[0].length>=6?f[0].substring(3,6):f[0].substring(3);

      if(st==='RMC'&&f.length>=10){
        if(f[2]!=='A')continue;
        const pos=parseLatLon(f[3],f[4],f[5],f[6]);
        const sog=parseFloat(f[7]);
        const dt=parseDateTime(f[1],f[9]);
        const ts=dt||logTs;
        if(ts){if(!startTime||ts<startTime)startTime=ts;if(!endTime||ts>endTime)endTime=ts;}
        if(pos){
          track.push({lat:pos.lat,lon:pos.lon,time:ts?ts.toISOString():null,sog:isNaN(sog)?null:sog});
          if(prevPos){const d=haversineNm(prevPos.lat,prevPos.lon,pos.lat,pos.lon);if(d<10)totalDist+=d;}
          prevPos=pos;
          // Add to 2-hour bucket
          if(ts){
            const bucket=Math.floor(ts.getUTCHours()/2)*2;
            if(!intervalBuckets[bucket]) intervalBuckets[bucket]={latSum:0,lonSum:0,count:0};
            intervalBuckets[bucket].latSum+=pos.lat;
            intervalBuckets[bucket].lonSum+=pos.lon;
            intervalBuckets[bucket].count++;
          }
        }
        if(!isNaN(sog)&&sog>=0)sogV.push(sog);
      }
      if(st==='VTG'&&f.length>=6){const sog=parseFloat(f[5]);if(!isNaN(sog)&&sog>=0&&sog<100)sogV.push(sog);}
      if(st==='GGA'&&f.length>=10&&parseInt(f[6],10)>0){
        const pos=parseLatLon(f[2],f[3],f[4],f[5]);
        if(pos&&track.length===0) track.push({lat:pos.lat,lon:pos.lon,time:logTs?logTs.toISOString():null,sog:null});
      }
      if(st==='MWV'&&f.length>=5){
        const angle=parseFloat(f[1]),ref=f[2],speed=parseFloat(f[3]),unit=f[4],status=strip(f[5]||'');
        if(!isNaN(speed)&&(status==='A'||status==='')){
          let kn=speed;if(unit==='M')kn=speed*1.94384;else if(unit==='K')kn=speed*0.539957;
          if(ref==='T'){if(kn>=0&&kn<200)twsV.push(kn);if(!isNaN(angle))twaV.push(angle);}
        }
      }
      if(st==='MWD'&&f.length>=6){const kn=parseFloat(f[5]);if(!isNaN(kn)&&kn>=0&&kn<200)twsV.push(kn);}
      if(st==='RPM'&&f.length>=4){
        const rpm=parseFloat(f[3]),status=strip(f[5]||'');
        if(!isNaN(rpm)&&(status==='A'||status===''))rpmE.push({time:logTs,rpm:Math.abs(rpm)});
      }
    }

    let engineHours=0;
    for(let i=1;i<rpmE.length;i++){
      if(rpmE[i].time&&rpmE[i-1].time&&rpmE[i-1].rpm>100){
        const dt=(rpmE[i].time-rpmE[i-1].time)/3600000;
        if(dt>0&&dt<1)engineHours+=dt;
      }
    }

    let displayTrack=track;
    if(track.length>2000){const step=Math.ceil(track.length/2000);displayTrack=track.filter((_,i)=>i%step===0||i===track.length-1);}

    const sogAvg=sogV.length?sogV.reduce((a,b)=>a+b,0)/sogV.length:null;
    const sogMax=sogV.length?Math.max(...sogV):null;
    const twsMax=twsV.length?Math.max(...twsV):null;
    const twsAvg=twsV.length?twsV.reduce((a,b)=>a+b,0)/twsV.length:null;
    const twaAvg=twaV.length?twaV.reduce((a,b)=>a+b,0)/twaV.length:null;
    const twaMin=twaV.length?Math.min(...twaV):null;
    const twaMax=twaV.length?Math.max(...twaV):null;

    // Build weather intervals array
    const weatherIntervals = Object.keys(intervalBuckets).sort((a,b)=>a-b).map(bucket => {
      const b = intervalBuckets[bucket];
      return {
        hour: parseInt(bucket, 10),
        lat: Math.round((b.latSum / b.count) * 10000) / 10000,
        lon: Math.round((b.lonSum / b.count) * 10000) / 10000
      };
    });

    return {
      track:displayTrack,
      totalDistanceNm:Math.round(totalDist*100)/100,
      startTime:startTime?startTime.toISOString():null,
      endTime:endTime?endTime.toISOString():null,
      durationHours:startTime&&endTime?Math.round((endTime-startTime)/3600000*100)/100:null,
      sogAvgKn:sogAvg!==null?Math.round(sogAvg*100)/100:null,
      sogMaxKn:sogMax!==null?Math.round(sogMax*100)/100:null,
      twsMaxKn:twsMax!==null?Math.round(twsMax*100)/100:null,
      twsAvgKn:twsAvg!==null?Math.round(twsAvg*100)/100:null,
      twaAvgDeg:twaAvg!==null?Math.round(twaAvg):null,
      twaMinDeg:twaMin!==null?Math.round(twaMin):null,
      twaMaxDeg:twaMax!==null?Math.round(twaMax):null,
      twaSamples:twaV.length,
      engineHours:Math.round(engineHours*100)/100,
      rpmSamples:rpmE.length,trackPoints:track.length,
      sogSamples:sogV.length,twsSamples:twsV.length,
      weatherIntervals
    };
  }

  // ── Core logging ────────────────────────────────────────────────
  function getDateString(){return new Date().toISOString().split('T')[0];}
  function getTimestamp(){return new Date().toISOString();}
  function exType(s){if(!s||s.length<6)return'UNKNOWN';const m=s.trim().match(/^[!$]([A-Z]{2})([A-Z]{2,4})/);return m?m[2]:'UNKNOWN';}
  function exFull(s){if(!s||s.length<6)return'UNKNOWN';const m=s.trim().match(/^[!$]([A-Z]{2,5})/);return m?m[1]:'UNKNOWN';}
  function shouldLog(t){
    if(config.logAllSentences)return true;if(config[`log_${t}`]===true)return true;
    if(config.logUnknownSentences&&!(t in SENTENCE_TYPES))return true;return false;
  }
  function getWriteStream(){
    const today=getDateString();if(currentLogDate===today&&currentWriteStream)return currentWriteStream;
    if(currentWriteStream){currentWriteStream.end();currentWriteStream=null;}
    if(!fs.existsSync(logDir))fs.mkdirSync(logDir,{recursive:true});
    const fp=path.join(logDir,`nmea0183_${today}.log`);
    currentWriteStream=fs.createWriteStream(fp,{flags:'a'});currentLogDate=today;
    currentWriteStream.on('error',e=>{app.error(`Log error: ${e.message}`);currentWriteStream=null;});
    return currentWriteStream;
  }
  function handleSentence(s){
    if(!s||typeof s!=='string')return;
    const t=exType(s),fid=exFull(s);sentenceStats[fid]=(sentenceStats[fid]||0)+1;
    if(!shouldLog(t))return;const stream=getWriteStream();if(!stream)return;
    stream.write(config.includeTimestamp?`${getTimestamp()} ${s.trim()}\n`:`${s.trim()}\n`);
  }
  function updateStatus(){
    const e=Object.entries(sentenceStats).sort((a,b)=>b[1]-a[1]);
    if(!e.length){app.setPluginStatus('Listening...');return;}
    app.setPluginStatus(`Logging ${currentLogDate}. `+e.map(([t,c])=>`${t}:${c}`).join(' '));
  }

  let pluginRunning = false;
  const ROUTE_PREFIX = '/plugins/signalk-nmea0183-logger';

  // Helper: validate log filename
  function validFn(fn) {
    fn = path.basename(fn);
    return (fn.startsWith('nmea0183_') && fn.endsWith('.log')) ? fn : null;
  }

  plugin.start=function(o){
    config=o||{};sentenceStats={};pluginRunning=true;
    logDir=config.logDirectory||path.join(app.getDataDirPath(),'nmea0183-logs');
    if(!fs.existsSync(logDir))fs.mkdirSync(logDir,{recursive:true});
    app.on('nmea0183',handleSentence);unsubscribe=()=>app.removeListener('nmea0183',handleSentence);
    statusInterval=setInterval(updateStatus,10000);app.setPluginStatus('Started.');

    // ── Public GET routes (no auth) registered on Express app directly ──
    app.get(ROUTE_PREFIX+'/api/logs',(req,res)=>{
      if(!pluginRunning)return res.status(503).json({error:'Plugin stopped'});
      if(!logDir||!fs.existsSync(logDir))return res.json([]);
      try{
        res.json(fs.readdirSync(logDir).filter(f=>f.startsWith('nmea0183_')&&f.endsWith('.log'))
          .sort().reverse().map(f=>{const s=fs.statSync(path.join(logDir,f));
          return{name:f,size:s.size,modified:s.mtime.toISOString(),date:f.replace('nmea0183_','').replace('.log','')};}));
      }catch(e){res.status(500).json({error:e.message});}
    });

    app.get(ROUTE_PREFIX+'/api/logs/:fn',(req,res)=>{
      if(!pluginRunning)return res.status(503).json({error:'Plugin stopped'});
      const fn=validFn(req.params.fn);if(!fn)return res.status(400).json({error:'Invalid'});
      const fp=path.join(logDir,fn);if(!fs.existsSync(fp))return res.status(404).json({error:'Not found'});
      const lines=parseInt(req.query.lines)||0,filter=req.query.filter||'';
      try{const c=fs.readFileSync(fp,'utf8');let a=c.split('\n').filter(l=>l.trim());const tot=a.length;
        if(filter){const fu=filter.toUpperCase();a=a.filter(l=>l.toUpperCase().includes(fu));}
        if(lines>0)a=a.slice(-lines);
        res.json({filename:fn,totalLines:tot,returnedLines:a.length,filter:filter||null,lines:a});
      }catch(e){res.status(500).json({error:e.message});}
    });

    app.get(ROUTE_PREFIX+'/api/logs/:fn/stats',(req,res)=>{
      if(!pluginRunning)return res.status(503).json({error:'Plugin stopped'});
      const fn=validFn(req.params.fn);if(!fn)return res.status(400).json({error:'Invalid'});
      const fp=path.join(logDir,fn);if(!fs.existsSync(fp))return res.status(404).json({error:'Not found'});
      try{const st=parseLogFile(fp);st.filename=fn;res.json(st);}
      catch(e){res.status(500).json({error:e.message});}
    });

    app.get(ROUTE_PREFIX+'/api/logs/:fn/download',(req,res)=>{
      if(!pluginRunning)return res.status(503).json({error:'Plugin stopped'});
      const fn=validFn(req.params.fn);if(!fn)return res.status(400).json({error:'Invalid'});
      const fp=path.join(logDir,fn);if(!fs.existsSync(fp))return res.status(404).json({error:'Not found'});
      res.download(fp,fn);
    });

    app.get(ROUTE_PREFIX+'/api/stats',(req,res)=>{
      if(!pluginRunning)return res.status(503).json({error:'Plugin stopped'});
      res.json({logDirectory:logDir,currentLogFile:currentLogDate?`nmea0183_${currentLogDate}.log`:null,sentenceStats});
    });
  };

  plugin.stop=function(){
    pluginRunning=false;
    if(unsubscribe){unsubscribe();unsubscribe=null;}
    if(statusInterval){clearInterval(statusInterval);statusInterval=null;}
    if(currentWriteStream){currentWriteStream.end();currentWriteStream=null;currentLogDate=null;}
    sentenceStats={};
  };

  // ── Authenticated routes only (DELETE) ────────────────────────────
  plugin.registerWithRouter=function(router){
    router.delete('/api/logs/:fn',(req,res)=>{
      const fn=validFn(req.params.fn);if(!fn)return res.status(400).json({error:'Invalid'});
      const fp=path.join(logDir,fn);if(!fs.existsSync(fp))return res.status(404).json({error:'Not found'});
      try{fs.unlinkSync(fp);res.json({deleted:fn});}catch(e){res.status(500).json({error:e.message});}
    });
  };
  plugin.getOpenApi=()=>({});

  // ── Schema ──────────────────────────────────────────────────────
  plugin.schema=function(){
    const sp={},groups={nav:['GGA','GLL','RMC','RMB','VTG','GSA','GSV','ZDA','GNS'],
      compass:['HDG','HDM','HDT'],wind:['MWV','MWD','VWR'],depth:['DBT','DBS','DBK','DPT'],
      speed:['VHW'],wpt:['APB','BOD','BWC','BWR','RTE','WPL','XTE','XDR'],
      ap:['RSA','RPM'],env:['MTW','MTA','MMB','MDA'],ais:['VDM','VDO'],misc:['TXT','TTM','TLL']};
    Object.values(groups).flat().forEach(t=>{sp[`log_${t}`]={type:'boolean',title:`${t} – ${SENTENCE_TYPES[t]}`,default:true};});
    const h=t=>({type:'string',title:t,description:' ',default:' '});
    const e=ts=>Object.fromEntries(ts.map(t=>[`log_${t}`,sp[`log_${t}`]]));
    return{type:'object',title:'NMEA0183 Logger',description:'Configure sentences. View via Webapps.',
      properties:{
        logDirectory:{type:'string',title:'Log Directory',default:''},
        includeTimestamp:{type:'boolean',title:'Include ISO Timestamp',default:true},
        logAllSentences:{type:'boolean',title:'Log ALL (override)',default:false},
        logUnknownSentences:{type:'boolean',title:'Log Unknown Types',default:true},
        _h1:h('── Navigation ──'),...e(groups.nav),_h2:h('── Compass ──'),...e(groups.compass),
        _h3:h('── Wind ──'),...e(groups.wind),_h4:h('── Depth ──'),...e(groups.depth),
        _h5:h('── Speed ──'),...e(groups.speed),
        _h6:h('── WPT / Route / AP ──'),...e([...groups.wpt,...groups.ap]),
        _h7:h('── Environment ──'),...e(groups.env),_h8:h('── AIS ──'),...e(groups.ais),
        _h9:h('── Misc ──'),...e(groups.misc)
      }};
  };
  return plugin;
};
