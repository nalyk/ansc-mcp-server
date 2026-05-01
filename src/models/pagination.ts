import { z } from 'zod';

export const ITEMS_PER_PAGE = 30;

export const PaginationSchema = z.object({
  currentPage: z.number().int().nonnegative().describe('Zero-based page number.'),
  totalPages: z.number().int().nonnegative(),
  perPage: z.number().int().positive(),
  totalItems: z.number().int().nonnegative().optional(),
  hasNextPage: z.boolean(),
  hasPrevPage: z.boolean(),
});
export type Pagination = z.infer<typeof PaginationSchema>;

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    pagination: PaginationSchema,
  });

export interface PaginatedResponse<T> {
  items: T[];
  pagination: Pagination;
}

export interface PaginationParams {
  page?: number;
}
