const t = await (await fetch('https://customapp-qwsi.onrender.com/login')).text();
const m = t.match(/__NEXTAUTH\s*=\s*(\{.*?\});/);
if (m) console.log('__NEXTAUTH:', m[1]);
else {
  const s = t.match(/next-auth/i);
  console.log('next-auth in page:', s ? 'yes' : 'no');
  const c = t.match(/__NEXT_AUTH/i);
  console.log('__NEXT_AUTH:', c ? c[0] : 'not found');
  const a = t.match(/baseUrl/i);
  console.log('baseUrl in page:', a ? 'yes' : 'no');
  console.log('HTML snippet:', t.substring(9000, 9500));
}
