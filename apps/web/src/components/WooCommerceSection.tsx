import React from "react"
import { FormTestResultCard } from "./FormTestResultCard"
import {
  ShoppingBag,
  ShoppingCart,
  CreditCard,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ExternalLink,
  ClipboardList,
} from "lucide-react"
import { QAFinding } from "../api/runs.api"

interface WooCommerceSectionProps {
  findings: QAFinding[]
}

interface TestResultProps {
  label: string
  isPassed: boolean
  pageUrl?: string
  error?: string
}

const TestResult: React.FC<TestResultProps> = ({
  label,
  isPassed,
  pageUrl,
  error,
}) => (
  <div className="flex items-start justify-between p-3 rounded-xl bg-slate-50 border border-slate-100 hover:bg-slate-50 hover:shadow-sm transition-all duration-300">
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-center gap-2">
        {isPassed ? (
          <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
        ) : (
          <XCircle size={14} className="text-red-500 shrink-0" />
        )}
        <span
          className={`text-[11px] font-bold uppercase tracking-tight ${isPassed ? "text-slate-700" : "text-red-700"}`}
        >
          {label}
        </span>
      </div>
      {pageUrl && (
        <div className="flex items-center gap-1.5 text-[9px] text-slate-400 font-medium truncate">
          <ExternalLink size={10} />
          {pageUrl}
        </div>
      )}
      {!isPassed && error && (
        <p className="text-[10px] text-red-500 font-medium mt-1 leading-relaxed italic">
          {error}
        </p>
      )}
    </div>
    <div
      className={`px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-widest ${
        isPassed ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
      }`}
    >
      {isPassed ? "Passed" : "Failed"}
    </div>
  </div>
)

export const WooCommerceSection: React.FC<WooCommerceSectionProps> = ({
  findings,
}) => {
  const wooFindings = findings.filter((f) => f.check_factor === "woocommerce")
  const formFindings = findings.filter((f) => f.check_factor === "forms")

  // Helper to determine if a specific check passed
  const isCheckPassed = (labelKeyword: string, pageTypeKeyword?: string) => {
    return !wooFindings.some(
      (f) =>
        f.title.toLowerCase().includes(labelKeyword.toLowerCase()) &&
        (!pageTypeKeyword ||
          f.description?.toLowerCase().includes(pageTypeKeyword.toLowerCase())),
    )
  }

  const getFindingForCheck = (
    labelKeyword: string,
    pageTypeKeyword?: string,
  ) => {
    return wooFindings.find(
      (f) =>
        f.title.toLowerCase().includes(labelKeyword.toLowerCase()) &&
        (!pageTypeKeyword ||
          f.description?.toLowerCase().includes(pageTypeKeyword.toLowerCase())),
    )
  }

  return (
    <div className="space-y-10 py-4 animate-in fade-in duration-500">
      {/* 1. Product Pages Section */}
      <section className="space-y-6">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
            <ShoppingBag size={20} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest">
              Product Integrity
            </h3>
            <p className="text-[10px] text-slate-500 font-medium">
              Verification of shop and product catalog elements
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <TestResult
            label="Product Titles"
            isPassed={isCheckPassed("Product title")}
            error={
              getFindingForCheck("Product title")?.description || undefined
            }
          />
          <TestResult
            label="Pricing Display"
            isPassed={isCheckPassed("Product price")}
            error={
              getFindingForCheck("Product price")?.description || undefined
            }
          />
          <TestResult
            label="Add to Cart Buttons"
            isPassed={isCheckPassed("Add to cart button")}
            error={
              getFindingForCheck("Add to cart button")?.description || undefined
            }
          />
          <TestResult
            label="Accessibility (Alt Tags)"
            isPassed={isCheckPassed("missing alt text")}
            error={
              getFindingForCheck("missing alt text")?.description || undefined
            }
          />
        </div>
      </section>

      {/* 2. Cart Flow Section */}
      <section className="space-y-6">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
            <ShoppingCart size={20} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest">
              Cart Flow
            </h3>
            <p className="text-[10px] text-slate-500 font-medium">
              Testing items addition and cart functionality
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <TestResult
            label="Cart Addition Success"
            isPassed={isCheckPassed("cart appears empty")}
            error={
              getFindingForCheck("cart appears empty")?.description || undefined
            }
          />
          <TestResult
            label="Quantity Controls"
            isPassed={isCheckPassed("Quantity input")}
            error={
              getFindingForCheck("Quantity input")?.description || undefined
            }
          />
          <TestResult
            label="Checkout Navigation"
            isPassed={isCheckPassed("Proceed to checkout button")}
            error={
              getFindingForCheck("Proceed to checkout button")?.description ||
              undefined
            }
          />
        </div>
      </section>

      {/* 3. Checkout Flow Section */}
      <section className="space-y-6">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <div className="p-2 bg-purple-50 text-indigo-600 rounded-xl">
            <CreditCard size={20} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest">
              Checkout & Security
            </h3>
            <p className="text-[10px] text-slate-500 font-medium">
              Validating payment portals and SSL compliance
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <TestResult
            label="Billing Fields"
            isPassed={
              isCheckPassed("Billing first name") &&
              isCheckPassed("Billing address")
            }
            error="Missing critical billing information fields."
          />
          <TestResult
            label="Payment Methods"
            isPassed={isCheckPassed("Payment methods section")}
            error={
              getFindingForCheck("Payment methods section")?.description ||
              undefined
            }
          />
          <TestResult
            label="HTTPS/SSL Security"
            isPassed={isCheckPassed("not using HTTPS")}
            error={
              getFindingForCheck("not using HTTPS")?.description || undefined
            }
          />
        </div>
      </section>

      {/* 4. Form Submission Results */}
      {formFindings.length > 0 && (
        <section className="space-y-6">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
            <div className="p-2 bg-orange-50 text-orange-600 rounded-xl">
              <ClipboardList size={20} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest">
                Form Testing
              </h3>
              <p className="text-[10px] text-slate-500 font-medium">
                Automated submission and confirmation validation
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {formFindings.map((finding) => (
              <FormTestResultCard key={finding.id} finding={finding} />
            ))}
          </div>
        </section>
      )}

      {wooFindings.length === 0 && formFindings.length === 0 && (
        <div className="py-20 text-center bg-slate-50 rounded-md border border-dashed border-slate-200">
          <AlertCircle size={40} className="mx-auto text-slate-300 mb-4" />
          <p className="text-slate-900 font-bold uppercase tracking-tight">
            No commerce results yet
          </p>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">
            Commerce checks will appear here once the scan progresses to these
            steps.
          </p>
        </div>
      )}
    </div>
  )
}
