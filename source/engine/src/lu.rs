// LU factorization (Crout's method with partial pivoting) and solve.
// Direct port of circuitjs1's SimulationManager.lu_factor_dense / lu_solve_dense,
// operating on a flat row-major matrix for cache efficiency.

/// Factor matrix `a` (n x n, row-major, len = n*n) in place.
/// Returns pivot indices via `ipvt`. Returns false if singular.
pub fn lu_factor(a: &mut [f64], n: usize, ipvt: &mut [i32]) -> bool {
    // check for rows that are all zeroes -> singular
    for i in 0..n {
        let mut all_zero = true;
        for j in 0..n {
            if a[i * n + j] != 0.0 {
                all_zero = false;
                break;
            }
        }
        if all_zero {
            return false;
        }
    }

    // Crout's method; loop through the columns
    for j in 0..n {
        // upper triangular elements for this column
        for i in 0..j {
            let mut q = a[i * n + j];
            for k in 0..i {
                q -= a[i * n + k] * a[k * n + j];
            }
            a[i * n + j] = q;
        }

        // lower triangular elements for this column, with pivot search
        let mut largest = 0.0f64;
        let mut largest_row: isize = -1;
        for i in j..n {
            let mut q = a[i * n + j];
            for k in 0..j {
                q -= a[i * n + k] * a[k * n + j];
            }
            a[i * n + j] = q;
            let x = q.abs();
            if x >= largest {
                largest = x;
                largest_row = i as isize;
            }
        }

        // pivoting
        if j as isize != largest_row {
            if largest_row == -1 {
                return false;
            }
            let lr = largest_row as usize;
            for k in 0..n {
                a.swap(lr * n + k, j * n + k);
            }
        }
        ipvt[j] = largest_row as i32;

        // zero pivot -> singular
        if a[j * n + j] == 0.0 {
            return false;
        }

        if j != n - 1 {
            let mult = 1.0 / a[j * n + j];
            for i in (j + 1)..n {
                a[i * n + j] *= mult;
            }
        }
    }
    true
}

/// Solve A x = b using the factorization produced by lu_factor.
/// On output `b` contains the solution.
pub fn lu_solve(a: &[f64], n: usize, ipvt: &[i32], b: &mut [f64]) {
    // find first nonzero b element
    let mut i = 0usize;
    while i < n {
        let row = ipvt[i] as usize;
        let swap = b[row];
        b[row] = b[i];
        b[i] = swap;
        if swap != 0.0 {
            break;
        }
        i += 1;
    }

    let bi = i;
    i += 1;
    while i < n {
        let row = ipvt[i] as usize;
        let mut tot = b[row];
        b[row] = b[i];
        // forward substitution (lower triangular)
        let mut j = bi;
        while j < i {
            tot -= a[i * n + j] * b[j];
            j += 1;
        }
        b[i] = tot;
        i += 1;
    }

    // back substitution (upper triangular)
    let mut ii = n as isize - 1;
    while ii >= 0 {
        let i = ii as usize;
        let mut tot = b[i];
        let mut j = i + 1;
        while j < n {
            tot -= a[i * n + j] * b[j];
            j += 1;
        }
        b[i] = tot / a[i * n + i];
        ii -= 1;
    }
}
