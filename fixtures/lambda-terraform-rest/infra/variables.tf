variable "region" {
  description = "Region the library is deployed to."
  type        = string
  default     = "eu-west-1"
}

variable "stage" {
  description = "Deployment stage, part of every name."
  type        = string
  default     = "dev"
}

variable "reminder_channels" {
  description = "Channels overdue reminders are sent on, one function each."
  type        = list(string)
}
