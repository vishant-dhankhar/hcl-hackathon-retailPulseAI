# Orders, support and inventory policy

RetailPulse AI hackathon demonstration policy. Version: demo-1. Effective from: 10 October 2026. Country: India. Applies to all product categories and membership tiers. These rules describe the implemented MVP workflow.

## Order cancellation and stock restoration

A customer may cancel their own order while its status is PLACED. Once fulfillment advances beyond PLACED, self-service cancellation is unavailable; the customer should contact support. A successful cancellation restores each ordered quantity to the original fulfillment location exactly once. Repeating a cancellation does not restore additional stock. Cancellation of a simulated order does not initiate a real refund.

## Order progress

Pickup orders progress from PLACED to READY_FOR_PICKUP and then COLLECTED. Delivery orders progress from PLACED to PROCESSING, then SHIPPED, then DELIVERED. The assigned location manager or an administrator updates fulfillment. Customers can view their own order history and current order status.

## Support routing

Customers should select the relevant order when raising a purchase-related ticket. The server routes that ticket to the order's actual fulfillment location. Pickup-order tickets are handled by the manager assigned to the pickup store. Delivery-order tickets are handled by the central fulfillment manager. A general question is associated with the selected physical store, and unassigned tickets are handled by administrators.

## Support answers and escalation

Assigned managers can send customer-visible answers, escalate open tickets to administrators, and resolve tickets. Administrators can answer and resolve tickets across locations. A ticket must contain a staff answer before it can be resolved. Customers can see saved answers, author names, role labels, timestamps and ticket status, including after resolution. Staff should base policy explanations on the current approved policies and escalate questions when policy evidence is missing or unclear. A support reply does not itself change an order, approve a return or move stock.

## Support priority

Platinum customer tickets have URGENT priority. Gold customer tickets have HIGH priority. Standard and Silver customer tickets have NORMAL priority. Staff queues show urgent tickets first, then high-priority tickets, then normal tickets; older tickets appear first within each priority. No response-time guarantee is specified in this MVP.

## Replenishment

Store managers may request replenishment only for their assigned locations; administrators may manage all locations. Staff enter a replenishment quantity and reason, approve or reject the request, and receive an approved request after stock arrives. Inventory increases only when the approved replenishment is received. Receiving the same request again must not add stock a second time. A rejected request does not increase stock. The MVP does not perform supplier procurement or transfers between stores.

## Policy administration and customer answers

Only administrators may upload, activate or retire policy documents. Uploading alone does not publish a policy: processing must finish successfully and the administrator must activate the version. Customer policy answers must use active, successfully processed documents matching the effective date, country, product category, membership tier and audience. Retired, future-dated or inapplicable policies must not support customer answers. If approved evidence is missing, the assistant should say that it cannot confirm the policy and direct the customer to support.
