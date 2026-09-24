//! STRATA native kernels for WebAssembly (built with `+simd128`).
//!
//! Every kernel mirrors a TypeScript implementation operation for operation so that results
//! are bit-identical (IEEE-754 doubles, no fused multiply-add). The TypeScript side remains the
//! reference and the fallback when WebAssembly SIMD is unavailable.

mod noise;

use std::alloc::{alloc, dealloc, Layout};

/// Allocate `size` bytes (16-byte aligned) in linear memory.
#[no_mangle]
pub extern "C" fn st_alloc(size: usize) -> *mut u8 {
    match Layout::from_size_align(size.max(1), 16) {
        Ok(layout) => unsafe { alloc(layout) },
        Err(_) => core::ptr::null_mut(),
    }
}

/// Free memory returned by [`st_alloc`] (the same `size` must be passed back).
///
/// # Safety
/// `ptr` must come from `st_alloc(size)` and must not be used afterwards.
#[no_mangle]
pub unsafe extern "C" fn st_free(ptr: *mut u8, size: usize) {
    if ptr.is_null() {
        return;
    }
    if let Ok(layout) = Layout::from_size_align(size.max(1), 16) {
        dealloc(ptr, layout);
    }
}

/// ABI version checked by the loader.
#[no_mangle]
pub extern "C" fn st_version() -> u32 {
    1
}

pub use noise::noise_batch;
