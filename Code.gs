/**
 * FEEDBACK STORE DASHBOARD — BACKEND V2
 * Jalankan setupFeedbackStore() sekali, lalu setAdminPassword('password-ku') sekali.
 * Spreadsheet database dibuat otomatis dan disimpan pada Script Properties.
 */
const APP = {
  DB_ID_KEY:'FEEDBACK_STORE_DATABASE_ID',
  ADMIN_HASH_KEY:'FEEDBACK_ADMIN_PASSWORD_SHA256',
  DB_NAME:'FEEDBACK STORE DATABASE',
  GUIDE:'PETUNJUK',
  CONFIG:'MASTER_CONFIG',
  STATUSES:['Bisa Dijalurkan','Pending','Cancel'],
  CAPACITY:200,
  F_HEADERS:['NO','NAMA STORE','NO DO','NAMA CUSTOMER','FEEDBACK STORE','NOTE','TANGGAL RESCHEDULE (jika pending)','NAMA SMT','ALASAN PENDING'],
  C_HEADERS:['NAMA STORE','NO DO / SO','NAMA CUSTOMER','FEEDBACK STORE','NOTE','TANGGAL RESCHEDULE (jika pending)','NAMA SMT','ALASAN PENDING']
};
function doGet(){return HtmlService.createHtmlOutputFromFile('Index').setTitle('Feedback Store Dashboard').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);}
function setupFeedbackStore(){
  const db=db_(); configSheet_(db); guideSheet_(db); monthSheet_(db,new Date());
  return {ok:true,id:db.getId(),url:db.getUrl(),name:db.getName(),message:'Database siap. Jalankan setAdminPassword("User134838!") untuk membuat password Admin.'};
}
function setAdminPassword(password){
  if(!password || String(password).length<8) throw new Error('Password minimal 8 karakter.');
  PropertiesService.getScriptProperties().setProperty(APP.ADMIN_HASH_KEY,sha256_(String(password)));
  return 'Password Admin berhasil disetel.';
}
function getLoginConfig(){
  const db=db_(); const stores=readStores_(db);
  return {ok:true,stores:stores.map(s=>({kode:s.kode,nama:s.nama})),adminPasswordConfigured:!!PropertiesService.getScriptProperties().getProperty(APP.ADMIN_HASH_KEY)};
}
function loginStore(code){
  const db=db_(), s=store_(db,code), token=token_('STORE',s.kode);
  return {ok:true,token,role:'STORE',store:{kode:s.kode,nama:s.nama}};
}
function loginAdmin(p){
  const props=PropertiesService.getScriptProperties(), saved=props.getProperty(APP.ADMIN_HASH_KEY);
  if(!saved) throw new Error('Password Admin belum disetel. Jalankan setAdminPassword("password-anda") di Apps Script.');
  if(!p || String(p.username).toLowerCase()!=='admin' || sha256_(String(p.password||''))!==saved) throw new Error('Username atau password Admin salah.');
  return {ok:true,token:token_('ADMIN','ALL'),role:'ADMIN'};
}
function logout(token){CacheService.getScriptCache().remove('FS_'+token);return {ok:true};}
function getDashboardData(p){
  const sess=auth_(p&&p.token); const db=db_();
  const transactions=readAll_(db).filter(x=>sess.role==='ADMIN'||x.storeCode===sess.storeCode);
  transactions.sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.doNo.localeCompare(b.doNo));
  return {ok:true,transactions,role:sess.role,storeCode:sess.storeCode,totalRead:transactions.length};
}
function uploadTransactions(p){
  const sess=auth_(p&&p.token); if(sess.role!=='ADMIN') throw new Error('Hanya Admin yang boleh upload.');
  if(!p.date) throw new Error('Tanggal wajib dipilih.');
  const db=db_(), date=parseDate_(p.date), sh=monthSheet_(db,date);
  const f=Array.isArray(p.furniture)?p.furniture:[], c=Array.isArray(p.comser)?p.comser:[];
  if(!f.length&&!c.length) throw new Error('Tidak ada transaksi yang terbaca.');
  // Hanya kode Store yang terdaftar dan AKTIF di MASTER_CONFIG yang diproses.
  const stores=readStores_(db), byCode=new Map(stores.map(s=>[String(s.kode).trim().toUpperCase(),s]));
  const validRows=(rows)=>rows.filter(x=>byCode.has(String(x.storeCode||'').trim().toUpperCase()));
  const validF=validRows(f), validC=validRows(c);
  const skippedF=f.length-validF.length, skippedC=c.length-validC.length;
  const skippedCodes=[...new Set([...f,...c]
    .filter(x=>!byCode.has(String(x.storeCode||'').trim().toUpperCase()))
    .map(x=>String(x.storeCode||'(KOSONG)').trim().toUpperCase()))];
  const accepted=validF.length+validC.length;
  if(!accepted) throw new Error('Tidak ada transaksi yang memiliki kode Store terdaftar dan AKTIF di MASTER_CONFIG. Tidak ada data yang disimpan.');
  const block=findBlock_(sh,date)||createBlock_(sh,date);
  const result={added:0,updated:0,preserved:0};
  upsertService_(db,sh,block,'Furniture',validF,date,result);
  upsertService_(db,sh,block,'COMSER',validC,date,result);
  const skipped=skippedF+skippedC;
  const skippedInfo=skipped?` Dilewati ${skipped} transaksi dengan kode tidak terdaftar/tidak aktif (${skippedCodes.join(', ')}).`:'';
  return {ok:true,added:result.added,updated:result.updated,preserved:result.preserved,skipped,skippedCodes,
    message:`Upload selesai. Baru: ${result.added}, diperbarui: ${result.updated}, feedback dipertahankan: ${result.preserved}, dilewati: ${skipped}.${skippedInfo}`,
    month:sh.getName(),url:db.getUrl()};
}
function saveFeedback(p){
  const sess=auth_(p&&p.token); if(!p.date||!p.doNo) throw new Error('Data feedback tidak lengkap.');
  const status=String(p.status||''); if(!APP.STATUSES.includes(status)) throw new Error('Status feedback tidak valid.');
  if(status==='Pending'&&(!p.reschedule||!String(p.reason||'').trim())) throw new Error('Pending wajib mengisi tanggal reschedule dan alasan.');
  const db=db_(), date=parseDate_(p.date), sh=monthSheet_(db,date), block=findBlock_(sh,date);
  if(!block) throw new Error('Data tanggal ini belum diupload.');
  const service=p.service==='COMSER'?'COMSER':'Furniture';
  const col=service==='Furniture'?3:12, fbCol=service==='Furniture'?5:14, storeCol=service==='Furniture'?2:11;
  const codeCol=service==='Furniture'?25:32;
  const requestedCode=sess.role==='ADMIN'?String(p.storeCode||'').trim().toUpperCase():sess.storeCode;
  if(!requestedCode) throw new Error('Kode Store transaksi tidak tersedia.');
  const expectedStore=store_(db,requestedCode);
  const start=block.start+3, ids=sh.getRange(start,col,block.capacity,1).getDisplayValues();
  const codes=sh.getRange(start,codeCol,block.capacity,1).getDisplayValues();
  let row=0;
  for(let i=0;i<ids.length;i++){
    if(String(ids[i][0]).trim()===String(p.doNo).trim() && String(codes[i][0]).trim().toUpperCase()===requestedCode){row=start+i;break;}
  }
  if(!row) throw new Error('DO/SO tidak ditemukan pada Store dan tanggal tersebut.');
  const actualStore=String(sh.getRange(row,storeCol).getDisplayValue()).trim();
  if(actualStore!==expectedStore.nama) throw new Error('Store transaksi tidak cocok dengan MASTER_CONFIG.');
  const startCol=service==='Furniture'?2:11;
  const old=sh.getRange(row,startCol,1,8).getValues()[0];
  const vals=[actualStore,p.doNo,old[2]||'',status,p.note||'',status==='Pending'?p.reschedule:'',p.smt||'',status==='Pending'?p.reason||'':''];
  sh.getRange(row,startCol,1,8).setValues([vals]);
  // Feedback tetap ditampilkan di kolom FEEDBACK; hasilnya juga memperbarui STATUS OPERATIONAL.
  const operationalStatusCol=service==='Furniture'?22:29;
  sh.getRange(row,operationalStatusCol).setValue(status);
  return {ok:true,message:'Feedback berhasil disimpan.'};
}
function getDatabaseInfo(){const d=db_();return {id:d.getId(),url:d.getUrl(),name:d.getName()};}

/* Core upsert: data dengan feedback tidak disentuh sama sekali. */
function upsertService_(db,sh,b,service,rows,date,res){
  if(!rows.length)return;
  const furniture=service==='Furniture', idCol=furniture?3:12, storeCol=furniture?2:11, custCol=furniture?4:13, feedbackCol=furniture?5:14, codeCol=furniture?25:32;
  const start=b.start+3, idVals=sh.getRange(start,idCol,b.capacity,1).getDisplayValues(), codeVals=sh.getRange(start,codeCol,b.capacity,1).getDisplayValues();
  const lookup=new Map();
  idVals.forEach((r,i)=>{if(r[0])lookup.set(String(codeVals[i][0]).trim().toUpperCase()+'|'+String(r[0]).trim(),start+i);});
  rows.forEach(x=>{
    const id=String(x.doNo||'').trim(), st=store_(db,x.storeCode);
    if(!id)return;
    const key=st.kode+'|'+id; let row=lookup.get(key);
    if(row){
      const fb=String(sh.getRange(row,feedbackCol).getDisplayValue()).trim();
      if(fb){res.preserved++;return;}
      writeOperational_(sh,row,service,x,st,date); res.updated++;
    }else{
      row=findEmptyRow_(sh,b,service);
      if(!row) throw new Error('Kapasitas tanggal '+pDate_(date)+' penuh. Tingkatkan APP.CAPACITY.');
      if(furniture) sh.getRange(row,1,1,9).setValues([[row-(b.start+2),st.nama,id,x.customer||'','','','','','']]);
      else sh.getRange(row,11,1,8).setValues([[st.nama,id,x.customer||'','','','','','']]);
      writeOperational_(sh,row,service,x,st,date); lookup.set(key,row); res.added++;
    }
  });
}
function writeOperational_(sh,row,service,x,st,date){
  const col=service==='Furniture'?20:27;
  sh.getRange(row,col,1,7).setValues([[service,x.doNo||'',x.operationalStatus||'',x.installer||'',Utilities.formatDate(date,Session.getScriptTimeZone(),'yyyy-MM-dd'),st.kode,x.address||'']]);
  if(service==='Furniture'){sh.getRange(row,2).setValue(st.nama);sh.getRange(row,4).setValue(x.customer||'');}
  else{sh.getRange(row,11).setValue(st.nama);sh.getRange(row,13).setValue(x.customer||'');}
}
function findEmptyRow_(sh,b,service){
  const col=service==='Furniture'?3:12, vals=sh.getRange(b.start+3,col,b.capacity,1).getDisplayValues();
  for(let i=0;i<vals.length;i++)if(!vals[i][0])return b.start+3+i;
  return 0;
}
function readAll_(db){
  const out=[];
  const monthTabs=db.getSheets().filter(sh=>/^[A-ZÀ-Ü]+ \d{4}$/i.test(sh.getName()) && ![APP.CONFIG,APP.GUIDE].includes(sh.getName()));
  monthTabs.forEach(sh=>{
    const last=sh.getLastRow();
    if(last<1)return;
    // Metadata dashboard berada di T:AG (kolom 20-33).
    const values=sh.getRange(1,1,last,33).getValues();
    for(let r=0;r<values.length;r++){
      const m=values[r];
      const furnitureMarker=String(m[19]||'').trim().toUpperCase();
      const comserMarker=String(m[26]||'').trim().toUpperCase();
      if(furnitureMarker==='FURNITURE' && String(m[20]||'').trim()){
        out.push({
          service:'Furniture',
          date:dateOut_(m[23]),
          storeCode:String(m[24]||'').trim().toUpperCase(),
          store:String(m[1]||'').trim(),
          doNo:String(m[20]||m[2]||'').trim(),
          customer:m[3]||'',
          feedback:m[4]||'',
          note:m[5]||'',
          reschedule:dateOut_(m[6]),
          smt:m[7]||'',
          reason:m[8]||'',
          operationalStatus:m[21]||'',
          installer:m[22]||'',
          address:m[25]||''
        });
      }
      if(comserMarker==='COMSER' && String(m[27]||'').trim()){
        out.push({
          service:'COMSER',
          date:dateOut_(m[30]),
          storeCode:String(m[31]||'').trim().toUpperCase(),
          store:String(m[10]||'').trim(),
          doNo:String(m[27]||m[11]||'').trim(),
          customer:m[12]||'',
          feedback:m[13]||'',
          note:m[14]||'',
          reschedule:dateOut_(m[15]),
          smt:m[16]||'',
          reason:m[17]||'',
          operationalStatus:m[28]||'',
          installer:m[29]||'',
          address:m[32]||''
        });
      }
    }
  });
  return out;
}

/**
 * Diagnostik database untuk memastikan data yang tersimpan dapat dibaca dashboard.
 * Jalankan dari editor Apps Script; hasil tampil di Execution log.
 */
function diagnoseFeedbackStore(){
  const db=db_(), sheets=db.getSheets(), report=[];
  sheets.forEach(sh=>{
    const name=sh.getName();
    if(!/^[A-ZÀ-Ü]+ \d{4}$/i.test(name))return;
    const last=sh.getLastRow();
    let furnitureVisible=0,comserVisible=0,furnitureMeta=0,comserMeta=0;
    if(last>0){
      const v=sh.getRange(1,1,last,33).getValues();
      v.forEach(r=>{
        if(String(r[2]||'').trim())furnitureVisible++;
        if(String(r[11]||'').trim())comserVisible++;
        if(String(r[19]||'').trim().toUpperCase()==='FURNITURE'&&String(r[20]||'').trim())furnitureMeta++;
        if(String(r[26]||'').trim().toUpperCase()==='COMSER'&&String(r[27]||'').trim())comserMeta++;
      });
    }
    report.push({sheet:name,lastRow:last,furnitureVisible,comserVisible,furnitureMeta,comserMeta});
  });
  const all=readAll_(db);
  const result={
    databaseName:db.getName(),
    databaseId:db.getId(),
    databaseUrl:db.getUrl(),
    tabs:report,
    totalReadByDashboard:all.length,
    furnitureRead:all.filter(x=>x.service==='Furniture').length,
    comserRead:all.filter(x=>x.service==='COMSER').length,
    missingStoreCode:all.filter(x=>!x.storeCode).length,
    sample:all.slice(0,10)
  };
  Logger.log(JSON.stringify(result,null,2));
  return result;
}
function createBlock_(sh,date){
  const start=Math.max(3,sh.getLastRow()+2), cap=APP.CAPACITY, summary=start+3+cap+2;
  const needed=summary+7;if(needed>sh.getMaxRows())sh.insertRowsAfter(sh.getMaxRows(),needed-sh.getMaxRows());
  sh.getRange(start,1,1,18).merge().setValue('TANGGAL DATA: '+pDate_(date)).setFontWeight('bold').setBackground('#dce7ff');
  sh.getRange(start+1,1,1,9).merge().setValue('DIISI POOL — FURNITURE').setBackground('#ffe699').setFontWeight('bold');
  sh.getRange(start+1,11,1,8).merge().setValue('DIISI POOL — COMSER').setBackground('#ffe699').setFontWeight('bold');
  sh.getRange(start+2,1,1,9).setValues([APP.F_HEADERS]).setBackground('#edf2ff').setFontWeight('bold').setWrap(true);
  sh.getRange(start+2,11,1,8).setValues([APP.C_HEADERS]).setBackground('#edf2ff').setFontWeight('bold').setWrap(true);
  sh.getRange(start+2,20,1,7).setValues([['JASA F','NO DO F','STATUS F','INSTALLER F','TANGGAL F','KODE STORE F','ALAMAT F']]).setBackground('#333').setFontColor('#fff').setFontWeight('bold');
  sh.getRange(start+2,27,1,7).setValues([['JASA C','NO SO C','STATUS C','INSTALLER C','TANGGAL C','KODE STORE C','ALAMAT C']]).setBackground('#333').setFontColor('#fff').setFontWeight('bold');
  sh.getRange(start+2,34).setValue('KAPASITAS');sh.getRange(start+2,35).setValue(cap);
  sh.getRange(start+3,10,cap,1).setBackground('#202124');
  sh.getRange(summary,1,1,3).merge().setValue('SUMMARY FEEDBACK FURNITURE').setBackground('#dce7ff').setFontWeight('bold');
  sh.getRange(summary,11,1,3).merge().setValue('SUMMARY FEEDBACK COMSER').setBackground('#dce7ff').setFontWeight('bold');
  sh.getRange(summary+1,1,1,3).setValues([['STATUS FEEDBACK','JUMLAH','PERSENTASE']]);
  sh.getRange(summary+1,11,1,3).setValues([['STATUS FEEDBACK','JUMLAH','PERSENTASE']]);
  APP.STATUSES.forEach((s,i)=>{let rr=summary+2+i;sh.getRange(rr,1,1,3).setValues([[s,`=COUNTIF(E${start+3}:E${start+2+cap},A${rr})`,`=IFERROR(B${rr}/COUNTA(C${start+3}:C${start+2+cap}),0)`]]);sh.getRange(rr,11,1,3).setValues([[s,`=COUNTIF(N${start+3}:N${start+2+cap},K${rr})`,`=IFERROR(L${rr}/COUNTA(L${start+3}:L${start+2+cap}),0)`]]);});
  sh.setFrozenRows(2);sh.setColumnWidth(1,55);sh.setColumnWidths(2,17,155);sh.setColumnWidth(10,18);sh.setColumnWidths(20,15,145);sh.hideColumns(20,16);
  return {start,capacity:cap};
}
function findBlock_(sh,date){
  const key='TANGGAL DATA: '+pDate_(date), vals=sh.getRange(1,1,Math.max(1,sh.getLastRow()),1).getDisplayValues();
  for(let i=0;i<vals.length;i++)if(String(vals[i][0]).includes(key)){const start=i+1,cap=Number(sh.getRange(start+2,35).getValue())||APP.CAPACITY;return {start,capacity:cap};}
  return null;
}
function monthSheet_(db,date){
  const name=monthName_(date);let sh=db.getSheetByName(name);
  if(!sh){sh=db.insertSheet(name);sh.getRange(1,1,1,18).merge().setValue('FEEDBACK STORE — '+name).setFontWeight('bold').setFontSize(14).setBackground('#dce7ff');sh.setColumnWidth(10,18);}
  return sh;
}
function configSheet_(db){
  let sh=db.getSheetByName(APP.CONFIG);if(!sh){sh=db.insertSheet(APP.CONFIG);sh.getRange(1,1,1,3).setValues([['KODE_TUJUAN','NAMA_GRUP_TUJUAN','STATUS']]);}
  sh.getRange(1,1,1,3).setFontWeight('bold').setBackground('#d9e6ff');sh.setFrozenRows(1);sh.setColumnWidths(1,3,230);return sh;
}
function guideSheet_(db){let sh=db.getSheetByName(APP.GUIDE);if(!sh)sh=db.insertSheet(APP.GUIDE);if(sh.getLastRow()===0)sh.getRange(1,1,5,2).setValues([['FEEDBACK STORE DATABASE','KETERANGAN'],['DATABASE','Dibuat otomatis oleh Code.gs.'],['BULAN','Satu tab untuk setiap bulan.'],['UPLOAD','Upload baru menambah transaksi; transaksi yang sudah feedback tidak ditimpa.'],['MASTER CONFIG','Tambah Store pada MASTER_CONFIG: KODE_TUJUAN, NAMA_GRUP_TUJUAN, STATUS.']]);sh.getRange(1,1,1,2).setFontWeight('bold').setBackground('#d9e6ff');sh.setColumnWidth(1,190);sh.setColumnWidth(2,700);}
function readStores_(db){const sh=configSheet_(db),n=sh.getLastRow();return n<2?[]:sh.getRange(2,1,n-1,3).getDisplayValues().filter(r=>r[0]&&r[1]&&(r[2]||'AKTIF').toUpperCase()==='AKTIF').map(r=>({kode:r[0].trim().toUpperCase(),nama:r[1].trim(),status:r[2]||'AKTIF'}));}
function store_(db,code){const s=readStores_(db).find(x=>x.kode===String(code||'').trim().toUpperCase());if(!s)throw new Error('Store tidak ditemukan atau tidak aktif pada MASTER_CONFIG.');return s;}
function token_(role,code){const t=Utilities.getUuid().replace(/-/g,'');CacheService.getScriptCache().put('FS_'+t,JSON.stringify({role,storeCode:code}),21600);return t;}
function auth_(t){if(!t)throw new Error('Sesi tidak ditemukan. Silakan login kembali.');const v=CacheService.getScriptCache().get('FS_'+t);if(!v)throw new Error('Sesi berakhir. Silakan login kembali.');return JSON.parse(v);}
function db_(){const p=PropertiesService.getScriptProperties();let id=p.getProperty(APP.DB_ID_KEY);if(id){try{return SpreadsheetApp.openById(id)}catch(e){p.deleteProperty(APP.DB_ID_KEY);}}const d=SpreadsheetApp.create(APP.DB_NAME);p.setProperty(APP.DB_ID_KEY,d.getId());const first=d.getSheets()[0];first.setName(APP.GUIDE);guideSheet_(d);configSheet_(d);return d;}
function parseDate_(s){const a=String(s).split('-').map(Number);if(a.length!==3||!a[0]||!a[1]||!a[2])throw new Error('Format tanggal harus YYYY-MM-DD.');return new Date(a[0],a[1]-1,a[2],12);}
function pDate_(d){return Utilities.formatDate(d,Session.getScriptTimeZone(),'dd MMMM yyyy').toUpperCase();}
function monthName_(d){return ['JANUARI','FEBRUARI','MARET','APRIL','MEI','JUNI','JULI','AGUSTUS','SEPTEMBER','OKTOBER','NOVEMBER','DESEMBER'][d.getMonth()]+' '+d.getFullYear();}
function sha256_(s){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s,Utilities.Charset.UTF_8).map(b=>(b+256).toString(16).slice(-2)).join('');}
function dateOut_(v){return v instanceof Date?Utilities.formatDate(v,Session.getScriptTimeZone(),'yyyy-MM-dd'):v||'';}


function setAdminPassword(password){
  if(!password || String(password).length<8)
    throw new Error('Password minimal 8 karakter.');

  PropertiesService.getScriptProperties()
    .setProperty(
      APP.ADMIN_HASH_KEY,
      sha256_(String(password))
    );

  return 'Password Admin berhasil disetel.';
}
function setupPasswordAdmin() {
  setAdminPassword('User134838!');
  Logger.log('Password Admin berhasil disetel.');
}


/**
 * API BRIDGE untuk GitHub Pages.
 * Simpan secret di Script Properties dengan key FEEDBACK_API_SECRET.
 * Deploy sebagai Web App: Execute as Me, Who has access: Anyone.
 */
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const expected = PropertiesService.getScriptProperties().getProperty('FEEDBACK_API_SECRET');
    if (!expected || !body.secret || body.secret !== expected) {
      return apiJson_({ok:false,error:'Unauthorized'});
    }

    const allowed = {
      getLoginConfig: function(){ return getLoginConfig(); },
      loginStore: function(arg){ return loginStore(arg); },
      loginAdmin: function(arg){ return loginAdmin(arg); },
      logout: function(arg){ return logout(arg); },
      getDashboardData: function(arg){ return getDashboardData(arg); },
      uploadTransactions: function(arg){ return uploadTransactions(arg); },
      saveFeedback: function(arg){ return saveFeedback(arg); }
    };

    if (!body.fn || !Object.prototype.hasOwnProperty.call(allowed, body.fn)) {
      return apiJson_({ok:false,error:'Aksi API tidak diizinkan.'});
    }
    const result = allowed[body.fn](body.arg);
    return apiJson_({ok:true,result:result});
  } catch (err) {
    return apiJson_({ok:false,error:String(err && err.message ? err.message : err)});
  }
}

function apiJson_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Jalankan sekali dari editor Apps Script dengan secret acak yang kuat. */
function setFeedbackApiSecret(secret) {
  if (!secret || String(secret).length < 32) {
    throw new Error('Secret minimal 32 karakter.');
  }
  PropertiesService.getScriptProperties().setProperty('FEEDBACK_API_SECRET', String(secret));
  return 'FEEDBACK_API_SECRET berhasil disimpan.';
}
