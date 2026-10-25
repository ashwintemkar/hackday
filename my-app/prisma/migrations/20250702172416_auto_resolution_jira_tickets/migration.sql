-- CreateTable
CREATE TABLE "AutoResolution" (
    "id" TEXT NOT NULL,
    "ticketKey" TEXT NOT NULL,
    "matchedTicketKey" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "resolution" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "connectorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoResolution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutoResolution_ticketKey_key" ON "AutoResolution"("ticketKey");
