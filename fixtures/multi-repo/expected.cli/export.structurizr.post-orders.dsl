// Written by `flowatlas export structurizr` from what the code says; nothing here was run.
// Run it again rather than editing: `flowatlas export structurizr --check` fails when this file is out of date.
workspace "bookshop" "Containers and flows read from the code by flowatlas." {
  model {
    user = person "User" "Someone using a website of the project."
    bookshop = softwareSystem "bookshop" {
      billing = container "billing" "A service" "nestjs"
      gateway = container "gateway" "The one address the browser calls." "nestjs"
      orders = container "orders" "Takes and keeps orders." "nestjs"
      web = container "web" "A website" "angular"
      orders_store = container "orders store" "orders" "" "Database"
      invoice_messages = container "invoice messages" "invoice.requested" "" "Queue"
      order_messages = container "order messages" "order.archived +1 more" "" "Queue"
    }
    api_stripe_com = softwareSystem "api.stripe.com" "Outside the project; called from the code." "External"

    gateway -> api_stripe_com "POST /v1/charges" "HTTP"
    gateway -> billing "POST /invoices" "HTTP"
    gateway -> orders "GET /orders/:param" "HTTP"
    invoice_messages -> billing "delivers invoice.requested" "Messaging"
    order_messages -> billing "delivers order.created" "Messaging"
    orders -> order_messages "publishes order.archived +1 more" "Messaging"
    orders -> orders_store "reads and writes orders" "SQL"
    user -> web "Uses" "HTTPS"
    web -> gateway "GET /orders/:param +4 more" "HTTP"
  }

  views {
    container bookshop "Containers" {
      include *
      autolayout lr
    }

    dynamic bookshop "orders-post-orders" "POST /orders (orders)" {
      orders -> orders_store "writes orders" "SQL"
      orders -> order_messages "publishes order.created" "Messaging"
      order_messages -> billing "delivers order.created" "Messaging"
      autolayout lr
    }

    styles {
      element "Database" {
        shape Cylinder
      }
      element "Queue" {
        shape Pipe
      }
      element "External" {
        shape RoundedBox
      }
    }
  }
}
