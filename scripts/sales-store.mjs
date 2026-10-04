export function createSalesStore(db){
 if(db&&typeof db.all==='function'&&typeof db.get==='function'&&typeof db.put==='function'){
  return db;
 }
 const all=kind=>db.prepare('SELECT payload FROM records WHERE kind=? ORDER BY rowid').all(kind).map(r=>JSON.parse(r.payload));
 const get=(kind,id)=>{const r=db.prepare('SELECT payload FROM records WHERE kind=? AND id=?').get(kind,id);return r?JSON.parse(r.payload):null;};
 const put=(kind,v)=>{db.prepare('INSERT INTO records(kind,id,payload) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload').run(kind,v.id,JSON.stringify(v));return v;};
 const transaction=fn=>{if(typeof db?.exec==='function'){db.exec('BEGIN IMMEDIATE');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}}return fn();};
 return {all,get,put,transaction};
}
