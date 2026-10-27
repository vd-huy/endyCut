export interface CubeLut {
  /** LUT_3D_SIZE grid resolution (N³ entries). */
  size: number
  /** RGB triplets, R fastest; values normalized 0..1. */
  data: Float32Array
}
