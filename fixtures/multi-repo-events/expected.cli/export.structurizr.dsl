// Written by `flowatlas export structurizr` from what the code says; nothing here was run.
// Run it again rather than editing: `flowatlas export structurizr --check` fails when this file is out of date.
workspace "multi-repo-events" "Containers and flows read from the code by flowatlas." {
  model {
    multi_repo_events = softwareSystem "multi-repo-events" {
      loans = container "loans" "A service" "lambda"
      notifications = container "notifications" "Functions" "lambda"
      platform_events = container "platform-events" "A service" "lambda"
      routing = container "routing" "A service" "lambda"
      eventbridge_library_library_loans_messages = container "eventbridge/library/library.loans messages" "eventbridge/library/library.loans/LoanCreated, eventbridge/library/library.loans/LoanReturned" "" "Queue"
      sqs_messages = container "sqs messages" "sqs/library-audit, sqs/library-loan-digest" "" "Queue"
    }

    eventbridge_library_library_loans_messages -> routing "delivers eventbridge/library/library.loans/LoanCreated" "Messaging"
    loans -> eventbridge_library_library_loans_messages "publishes eventbridge/library/library.loans/LoanCreated, eventbridge/library/library.loans/LoanReturned" "Messaging"
    platform_events -> sqs_messages "publishes sqs/library-audit" "Messaging"
    routing -> notifications "invokes library-welcome-borrower" "Invoke"
    routing -> sqs_messages "publishes sqs/library-loan-digest" "Messaging"
    sqs_messages -> notifications "delivers sqs/library-loan-digest" "Messaging"
  }

  views {
    container multi_repo_events "Containers" {
      include *
      autolayout lr
    }

    dynamic multi_repo_events "loans-post-loans" "POST /loans (loans)" {
      loans -> eventbridge_library_library_loans_messages "publishes eventbridge/library/library.loans/LoanCreated" "Messaging"
      platform_events -> sqs_messages "publishes sqs/library-audit" "Messaging"
      eventbridge_library_library_loans_messages -> routing "delivers eventbridge/library/library.loans/LoanCreated" "Messaging"
      routing -> notifications "invokes library-welcome-borrower" "Invoke"
      autolayout lr
    }

    dynamic multi_repo_events "loans-post-loans-param-return" "POST /loans/:param/return (loans)" {
      loans -> eventbridge_library_library_loans_messages "publishes eventbridge/library/library.loans/LoanReturned" "Messaging"
      platform_events -> sqs_messages "publishes sqs/library-audit" "Messaging"
      routing -> sqs_messages "publishes sqs/library-loan-digest" "Messaging"
      sqs_messages -> notifications "delivers sqs/library-loan-digest" "Messaging"
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
