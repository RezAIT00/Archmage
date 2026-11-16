import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const w = new RAPIER.World({x:0,y:-10,z:0});
const nr=4,nc=4; const h=new Float32Array((nr+1)*(nc+1));
// test function: height = 10*x_index + z_index  -> see which index maps to which axis
for(let i=0;i<=nr;i++)for(let j=0;j<=nc;j++) h[i+j*(nr+1)] = i*1 + j*10;
const c=w.createCollider(RAPIER.ColliderDesc.heightfield(nr,nc,h,{x:8,y:1,z:8}));
w.step();
const probe=(x,z)=>{const hit=w.castRayAndGetNormal(new RAPIER.Ray({x,y:100,z},{x:0,y:-1,z:0}),200,true);return hit?(100-hit.timeOfImpact).toFixed(2)+' keys:'+Object.keys(hit).join(','):'none';};
console.log('(-4,-4)',probe(-3.99,-3.99),'(4,-4)',probe(3.99,-3.99),'(-4,4)',probe(-3.99,3.99),'(4,4)',probe(3.99,3.99));
const b=w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0,50,0).setSleeping(true));
w.createCollider(RAPIER.ColliderDesc.cuboid(.5,.5,.5),b); w.step(); console.log('sleeping body y after step', b.translation().y, b.isSleeping());
console.log(Object.getOwnPropertyNames(RAPIER.ActiveEvents), RAPIER.HeightFieldFlags);
