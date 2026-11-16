#ifndef MATH_UTILS_H
#define MATH_UTILS_H
#include <math.h>
#define MATH_TWO_PI 6.2831853071795864769f
static inline float clamp_f32(float value, float low, float high) { return fmaxf(low, fminf(high, value)); }
static inline float wrap_angle(float value) { float angle = fmodf(value, MATH_TWO_PI); return angle < 0 ? angle + MATH_TWO_PI : angle; }
static inline float wrap_angle_signed(float value) { return wrap_angle(value + 0.5f * MATH_TWO_PI) - 0.5f * MATH_TWO_PI; }
#endif
