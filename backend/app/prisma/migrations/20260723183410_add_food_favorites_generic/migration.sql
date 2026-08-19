/*
  Warnings:

  - A unique constraint covering the columns `[externalId]` on the table `FoodItem` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "FoodSource" ADD VALUE 'GENERIC';

-- CreateTable
CREATE TABLE "FoodFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "foodItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FoodFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FoodFavorite_userId_idx" ON "FoodFavorite"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FoodFavorite_userId_foodItemId_key" ON "FoodFavorite"("userId", "foodItemId");

-- CreateIndex
CREATE UNIQUE INDEX "FoodItem_externalId_key" ON "FoodItem"("externalId");

-- CreateIndex
CREATE INDEX "FoodItem_name_idx" ON "FoodItem"("name");

-- CreateIndex
CREATE INDEX "FoodItem_source_idx" ON "FoodItem"("source");

-- AddForeignKey
ALTER TABLE "FoodFavorite" ADD CONSTRAINT "FoodFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodFavorite" ADD CONSTRAINT "FoodFavorite_foodItemId_fkey" FOREIGN KEY ("foodItemId") REFERENCES "FoodItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
