const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const app = express();
const db = new Database(process.env.DB_PATH || 'windir.db');
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS keys (
 id INTEGER PRIMARY KEY AUTOINCREMENT, key_hash TEXT UNIQUE NOT NULL,
 label TEXT DEFAULT '', expires_at TEXT, created_at TEXT NOT NULL,
 revoked INTEGER DEFAULT 0, used_by TEXT DEFAULT ''
)`);
app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));
const sessions = new Map();
const adminPassword = process.env.ADMIN_PASSWORD;
const sessionSecret = process.env.SESSION_SECRET;
if (!adminPassword || !sessionSecret) console.warn('Set ADMIN_PASSWORD and SESSION_SECRET environment variables!');
function token(){return crypto.randomBytes(32).toString('hex')}
function hash(s){return crypto.createHash('sha256').update(s).digest('hex')}
function auth(req,res,next){
 const t=(req.headers.authorization||'').replace(/^Bearer /,'');
 if(!t || !sessions.has(t)){return res.status(401).json({error:'Admin login required'})}
 next();
}
app.post('/api/admin/login',(req,res)=>{
 if(!adminPassword || req.body.password!==adminPassword) return res.status(401).json({error:'Incorrect password'});
 const t=token(); sessions.set(t,Date.now()); res.json({token:t});
});
app.post('/api/admin/logout',auth,(req,res)=>{sessions.delete((req.headers.authorization||'').replace(/^Bearer /,''));res.json({ok:true})});
app.post('/api/admin/keys',auth,(req,res)=>{
 const days=Number(req.body.days||7), label=String(req.body.label||'').slice(0,80);
 if(!Number.isInteger(days)||days<1||days>3650) return res.status(400).json({error:'Days must be 1–3650'});
 const key='WINDIR-'+crypto.randomBytes(12).toString('hex').toUpperCase();
 const expires=new Date(Date.now()+days*86400000).toISOString();
 db.prepare('INSERT INTO keys(key_hash,label,expires_at,created_at) VALUES(?,?,?,?)').run(hash(key),label,expires,new Date().toISOString());
 res.json({key,expires_at:expires});
});
app.get('/api/admin/keys',auth,(req,res)=>{
 res.json(db.prepare('SELECT id,label,expires_at,created_at,revoked,used_by FROM keys ORDER BY id DESC LIMIT 200').all());
});
app.post('/api/admin/keys/:id/revoke',auth,(req,res)=>{
 const result=db.prepare('UPDATE keys SET revoked=1 WHERE id=?').run(req.params.id);
 res.json({ok:result.changes>0});
});
app.post('/api/keys/verify',(req,res)=>{
 const k=String(req.body.key||'').trim();
 if(!k) return res.status(400).json({valid:false,message:'Enter a key'});
 const row=db.prepare('SELECT expires_at,revoked FROM keys WHERE key_hash=?').get(hash(k));
 if(!row||row.revoked) return res.json({valid:false,message:'Invalid or revoked key'});
 if(Date.now()>Date.parse(row.expires_at)) return res.json({valid:false,message:'Key expired'});
 res.json({valid:true,message:'Key verified — access granted',expires_at:row.expires_at});
});
app.get('/api/health',(req,res)=>res.json({ok:true}));
const port=process.env.PORT||3000;
app.listen(port,()=>console.log('Windir Mode running on port '+port));
