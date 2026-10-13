# kasideliveries
Kasi Deliveries is a fast, reliable parcel delivery service built for the township. We collect from your door, deliver to your recipient, and keep you updated with tracking and photo proof at every step

## How an order works

This app is where the customer **builds the order**. Kasi Delivery, on WhatsApp, does everything after that.

1. The customer adds items to the cart and taps **Checkout via WhatsApp**.
2. This server looks the prices up in its own menus and hands the basket to Kasi Delivery.
3. WhatsApp opens with an order code already typed. The customer taps send.
4. Kasi Delivery asks their name and where to deliver, then sends the **invoice, with the delivery fee added**.
5. The shop accepts, the customer pays online, and a driver is sent. **Track Order** in this app shows where it is, with a live map once a driver has it.

One order is from one shop, which is how the cart already works.

## Settings on Railway (Variables)

| Variable | What it is |
|---|---|
| `DATABASE_URL` | The PostgreSQL database. Railway fills this in. |
| `KASI_API_KEY` | The key Kasi Delivery issued for this app. Without it, checkout only opens WhatsApp with the order typed out, and nothing is sent to Kasi Delivery. |
| `ADMIN_PASSWORD` | Optional. The first admin password on a brand new database. Without it the first password is `admin123`, and the first login is asked to change it. |
| `KASI_API_URL` | Optional. Only if Kasi Delivery's address changes. |

## For a shop to take delivery orders

The shop has to be on Kasi Delivery too, **under exactly the same name** as in this app, and it has to have sent `OPEN` to Kasi Delivery's WhatsApp number that day. A shop that is not there, or has not said OPEN, shows the customer "not taking orders right now" at checkout and nothing is sent.

## Admin

Log in at **Admin Portal** in the footer. Passwords are checked by the server and stored scrambled, so nobody can read them back, including on the User Management screen. To change one, type the new password next to the username and tap **Update Pass**.

The WhatsApp number customers are sent to is in **Branding & Content**. Type it any way you like (084 368 9501 or 27843689501); it is saved in the form WhatsApp links need.

## If you replace `server.js` or `index.html` with a new copy

Start from the files in this repository, not from an older copy. Pasting an older version over them removes the login, the price checks and the Kasi Delivery checkout without any error.
