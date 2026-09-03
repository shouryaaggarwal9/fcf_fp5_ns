import { z } from "zod";

export const PlaceOrderSchema = z
  .object({
    symbol: z.string().min(1, "Symbol is required"),
    productType: z.enum(["CNC", "MIS"]),
    orderType: z.enum(["MARKET", "LIMIT", "STOP_LIMIT"]),
    quantity: z.number().int().positive("Quantity must be a positive integer"),
    limitPrice: z
      .number()
      .positive("Limit price must be positive")
      .optional()
      .nullable(),
    triggerPrice: z
      .number()
      .positive("Trigger price must be positive")
      .optional()
      .nullable(),
    stopLossPrice: z
      .number()
      .positive("Stop loss price must be positive")
      .optional()
      .nullable(),
    virtualTime: z
      .string()
      .datetime({ message: "Invalid virtual timestamp format" }),
  })
  .superRefine((data, ctx) => {
    // Audit rule: LIMIT orders must specify limitPrice
    if (
      data.orderType === "LIMIT" &&
      (!data.limitPrice || data.limitPrice <= 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["limitPrice"],
        message: "Limit price is mandatory for LIMIT orders",
      });
    }

    // Audit rule: STOP_LIMIT orders must specify both triggerPrice and limitPrice
    if (data.orderType === "STOP_LIMIT") {
      if (!data.triggerPrice || data.triggerPrice <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["triggerPrice"],
          message: "Trigger price is mandatory for STOP_LIMIT orders",
        });
      }
      if (!data.limitPrice || data.limitPrice <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["limitPrice"],
          message: "Execution limit price is mandatory for STOP_LIMIT orders",
        });
      }
    }
  });

export type PlaceOrderInput = z.infer<typeof PlaceOrderSchema>;

export const PlaceGttSchema = z.object({
  symbol: z.string().min(1, "Symbol is required"),
  productType: z.enum(["CNC", "MIS"]),
  quantity: z.number().int().positive("Quantity must be a positive integer"),
  triggerPrice: z.number().positive("Trigger price must be greater than zero"),
  limitPrice: z.number().positive("Limit price must be greater than zero"),
});

export type PlaceGttInput = z.infer<typeof PlaceGttSchema>;
