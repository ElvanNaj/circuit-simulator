// JS replication of the Rust engine's diode iteration to find the divergence
const VT = 0.025865, VZCOEF = 1 / VT;
const leakage = 1.7143528192808883e-7, zvoltage = 0;
const vscale = VT, vdcoef = 1 / vscale;
const vcrit = vscale * Math.log(vscale / (Math.SQRT2 * leakage));

function limitStep(vnew, vold) {
  if (vnew > vcrit && Math.abs(vnew - vold) > (vscale + vscale)) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vscale;
      vnew = arg > 0 ? vold + vscale * Math.log(arg) : vcrit;
    } else {
      vnew = vscale * Math.log(vnew / vscale);
    }
    return [vnew, false];
  }
  return [vnew, true];
}

// circuit: V1=5 (node1) -- diode -- node2 -- 1k -- gnd
// MNA rows: [node1, node2, vs]; unknowns V1, V2, Ivs
let s0 = 0; // lastvoltdiff
let V1 = 0, V2 = 0;
let converged = true;
const maxSub = 100;
let subiter = 0;
for (; subiter < maxSub; subiter++) {
  converged = true;
  // do_step diode
  let vd = V1 - V2;
  if (Math.abs(vd - s0) > 0.01) converged = false;
  let limited;
  const res = limitStep(vd, s0); limited = res[0]; if (!res[1]) converged = false;
  s0 = limited;
  const gmin = leakage * 0.01;
  const ev = Math.exp(limited * vdcoef);
  const geq = vdcoef * leakage * ev + gmin;
  const nc = (ev - 1) * leakage - geq * limited;
  // build & solve 3x3: rows node1, node2, vs
  // A = [[G, -G, -1], [-G, G+1e-3, 0], [0, 1, 0]]  (from my stamps)
  // wait — check my stamp signs: [n1][vs] = +1? Let me use my code: stamp_voltage_source(n0=0(gnd), n1=node1):
  //   matrix[vr][n1_row] += 1; matrix[n1_row][vr] += -1;  (n0=ground skipped)
  // diode conductance: G between node1,node2
  // rhs: [0, nc, 5]
  const G = geq, R = 1e-3;
  const A = [
    [G, -G, -1],
    [-G, G + R, 0],
    [0, 1, 0],
  ];
  const b = [0, nc, 5];
  // gaussian elimination
  const n = 3;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = [0, 0, 0];
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
    x[r] = s / M[r][r];
  }
  V1 = x[0]; V2 = x[1];
  console.log(`subiter ${subiter}: vd_raw=${vd.toPrecision(8)} limited=${limited.toPrecision(8)} geq=${geq.toExponential(4)} nc=${nc.toExponential(4)} → V2=${V2.toPrecision(8)} converged=${converged}`);
  if (converged && subiter > 0) { console.log(`→ BREAK at subiter ${subiter}`); break; }
}
console.log('final V2 =', V2, 'vd =', V1 - V2);
